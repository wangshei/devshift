const { v4: uuid } = require('uuid');
const { execSync } = require('child_process');
const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Generate a PM status report for a project.
 * Called by the scheduler periodically (e.g., every 6 hours or when significant work completes).
 */
async function generateReport(projectId) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  // Gather context for the report
  const recentTasks = db.prepare(`
    SELECT title, status, tier, actual_minutes, worker, completed_at, execution_log
    FROM tasks WHERE project_id = ? AND (
      completed_at > datetime('now', '-24 hours')
      OR status IN ('in_progress', 'needs_review', 'failed')
      OR (status IN ('backlog', 'queued') AND task_type = 'agent')
    )
    ORDER BY
      CASE status WHEN 'in_progress' THEN 0 WHEN 'needs_review' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
      completed_at DESC
    LIMIT 30
  `).all(projectId);

  const goals = db.prepare("SELECT title, status, metric, target_value, current_value FROM goals WHERE project_id = ? AND status = 'active'").all(projectId);
  const features = db.prepare("SELECT title, status, priority FROM features WHERE project_id = ? AND status NOT IN ('done', 'cancelled') ORDER BY priority ASC LIMIT 10").all(projectId);
  const ideas = db.prepare("SELECT title, priority FROM ideas WHERE project_id = ? AND status = 'new' ORDER BY priority ASC LIMIT 5").all(projectId);

  // Get memories for context
  const pitfalls = db.prepare("SELECT content FROM project_memory WHERE project_id = ? AND category = 'pitfalls' ORDER BY updated_at DESC LIMIT 5").all(projectId);

  // Check if we already reported recently (within 6 hours)
  const recentReport = db.prepare("SELECT id FROM pm_reports WHERE project_id = ? AND created_at > datetime('now', '-6 hours')").get(projectId);
  if (recentReport) return null;

  // Skip if nothing happened
  const completedRecently = recentTasks.filter(t => t.status === 'done' && t.completed_at);
  const needsAttention = recentTasks.filter(t => ['needs_review', 'failed'].includes(t.status));
  const inProgress = recentTasks.filter(t => t.status === 'in_progress');
  const queued = recentTasks.filter(t => ['backlog', 'queued'].includes(t.status));

  if (completedRecently.length === 0 && needsAttention.length === 0 && inProgress.length === 0) {
    return null; // Nothing to report
  }

  const prompt = `You are the PM agent for "${project.name}". Generate a brief status report for the human.

## Recent Activity
${completedRecently.map(t => `- ✓ ${t.title} (${t.worker?.startsWith('human') ? 'human' : 'agent'}, ${t.actual_minutes || '?'}min)`).join('\n') || 'No completions'}

## Needs Attention
${needsAttention.map(t => `- ${t.status === 'failed' ? '✕' : '▸'} ${t.title} (${t.status}${t.execution_log ? ': ' + t.execution_log.slice(0, 100) : ''})`).join('\n') || 'Nothing'}

## In Progress
${inProgress.map(t => `- ● ${t.title} (${t.worker || 'agent'})`).join('\n') || 'Nothing'}

## Queue
${queued.length} tasks waiting

## Active Goals
${goals.map(g => `- ${g.title}${g.metric ? ' (' + g.metric + ': ' + (g.current_value || '?') + '/' + (g.target_value || '?') + ')' : ''}`).join('\n') || 'No goals set'}

## Open Features
${features.map(f => `- ${f.title} [${f.status}]`).join('\n') || 'No features'}

## New Ideas
${ideas.map(i => `- ${i.title}`).join('\n') || 'None'}

## Known Issues
${pitfalls.map(p => `- ${p.content.slice(0, 100)}`).join('\n') || 'None'}

Write a concise status report (3-5 short paragraphs) with:
1. **What happened** — key completions and progress
2. **What needs you** — items requiring human attention and why
3. **What's next** — what the agent plans to work on
4. **Suggestion** — one actionable recommendation for the human

Keep it conversational and brief — like a standup update from a teammate. No markdown headers, just natural paragraphs. Address the human directly ("you" not "the user").`;

  try {
    // Check if Claude is available
    const provider = db.prepare("SELECT * FROM providers WHERE id = 'claude_code' AND enabled = 1").get();
    if (!provider) return null;

    const output = execSync(
      `claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet`,
      { encoding: 'utf-8', timeout: 60000, cwd: project.repo_path }
    );

    const reportContent = output.trim();
    if (!reportContent || reportContent.length < 20) return null;

    // Determine report type
    let type = 'status';
    if (needsAttention.length > 0) type = 'attention';
    if (completedRecently.length >= 3) type = 'milestone';

    // Get PM agent for this project
    const pmAgent = db.prepare("SELECT id FROM agents WHERE project_id = ? AND role = 'pm'").get(projectId);

    const reportId = uuid();
    const title = type === 'attention' ? 'Needs your attention'
      : type === 'milestone' ? 'Progress update'
      : 'Status update';

    db.prepare(`
      INSERT INTO pm_reports (id, project_id, agent_id, type, title, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reportId, projectId, pmAgent?.id || null, type, title, reportContent);

    log.info(`[PMReport] Generated ${type} report for "${project.name}"`);
    return { id: reportId, type, title };
  } catch (e) {
    log.warn(`[PMReport] Failed for "${project.name}": ${e.message}`);
    return null;
  }
}

/**
 * Generate reports for all active projects.
 */
async function generateAllReports() {
  const db = getDb();
  const projects = db.prepare("SELECT id FROM projects WHERE paused = 0").all();

  for (const p of projects) {
    try {
      await generateReport(p.id);
    } catch (e) {
      log.debug(`[PMReport] Skipping project ${p.id}: ${e.message}`);
    }
    // Only generate one report per tick to conserve credits
    break;
  }
}

module.exports = { generateReport, generateAllReports };
