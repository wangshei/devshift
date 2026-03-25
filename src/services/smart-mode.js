const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const { executeTask } = require('./executor');
const log = require('../utils/logger');

/**
 * Smart Mode — proactive product improvement.
 *
 * When the user is offline and credits are available, Smart Mode:
 * 1. Picks a project
 * 2. Analyzes it for improvement opportunities
 * 3. Generates improvement tasks
 * 4. Executes them on a new branch
 *
 * This runs when: user is offline + credits expiring + no backlog tasks
 */

const ANALYSIS_PROMPTS = {
  code_quality: `Analyze this project's code quality. Look for:
- Functions that are too long or complex
- Missing error handling
- Inconsistent patterns
- Dead code or unused imports
- Missing or weak input validation
- Performance issues (N+1 queries, unnecessary re-renders, etc.)

Return a JSON array of specific improvements, each with:
{ "title": "short title", "description": "what to fix and why", "file": "path/to/file", "priority": 1-5 }

Return ONLY the JSON array, no other text.`,

  test_coverage: `Analyze this project's test coverage gaps. Look for:
- Core business logic without tests
- API endpoints without integration tests
- Edge cases not covered
- Error paths not tested

Return a JSON array of specific test tasks, each with:
{ "title": "short title", "description": "what to test", "file": "path/to/file", "priority": 1-5 }

Return ONLY the JSON array, no other text.`,

  docs_and_dx: `Analyze this project's documentation and developer experience. Look for:
- Missing or outdated README sections
- Functions/APIs without JSDoc or comments for non-obvious logic
- Missing setup instructions
- Outdated examples

Return a JSON array of specific improvements, each with:
{ "title": "short title", "description": "what to document", "file": "path/to/file", "priority": 1-5 }

Return ONLY the JSON array, no other text.`,

  security: `Analyze this project for security issues. Look for:
- Hardcoded secrets or credentials
- SQL injection or command injection risks
- XSS vulnerabilities
- Missing authentication/authorization checks
- Insecure dependencies
- Missing rate limiting on public endpoints

Return a JSON array of specific fixes, each with:
{ "title": "short title", "description": "the vulnerability and fix", "file": "path/to/file", "priority": 1-5 }

Return ONLY the JSON array, no other text.`,

  ux_improvements: `Analyze this project from a user experience perspective. Look at the UI/frontend code for:
- Missing loading states
- Missing error states / empty states
- Accessibility issues (missing labels, poor contrast, no keyboard nav)
- Mobile responsiveness gaps
- Missing user feedback (no success/error toasts, no confirmations)

Return a JSON array of specific UX improvements, each with:
{ "title": "short title", "description": "the improvement and why it matters", "file": "path/to/file", "priority": 1-5 }

Return ONLY the JSON array, no other text.`,
};

/**
 * Run Smart Mode analysis on a project and generate improvement tasks.
 */
async function analyzeProject(projectId, analysisType = 'code_quality') {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Project not found');

  const prompt = ANALYSIS_PROMPTS[analysisType];
  if (!prompt) throw new Error(`Unknown analysis type: ${analysisType}`);

  log.info(`[SmartMode] Running ${analysisType} analysis on "${project.name}"`);

  // Create a virtual analysis task
  const analysisTaskId = uuid();
  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, task_type, tier, status, model)
    VALUES (?, ?, ?, ?, 'agent', 3, 'in_progress', 'sonnet')
  `).run(analysisTaskId, projectId,
    `Smart Mode: ${analysisType.replace(/_/g, ' ')} analysis`,
    prompt);

  try {
    const result = await executeTask(analysisTaskId);

    if (result.success && result.output) {
      const tasks = parseAnalysisOutput(result.output);
      if (tasks.length > 0) {
        const created = createImprovementTasks(projectId, tasks, analysisType);
        log.info(`[SmartMode] Generated ${created} improvement tasks for "${project.name}"`);
        return { success: true, tasksCreated: created, analysis: analysisType };
      }
    }

    return { success: false, error: 'No improvements found' };
  } catch (e) {
    log.error(`[SmartMode] Analysis failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Parse the AI's analysis output into structured tasks.
 */
function parseAnalysisOutput(output) {
  try {
    // Try to find a JSON array in the output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* not valid JSON */ }

  // Fallback: try to extract tasks from natural language
  const tasks = [];
  const lines = output.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const cleaned = line.replace(/^[-*\d.]+\s*/, '').trim();
    if (cleaned.length > 10 && cleaned.length < 200) {
      tasks.push({ title: cleaned, priority: 3 });
    }
  }
  return tasks.slice(0, 10); // Cap at 10 tasks
}

/**
 * Create improvement tasks from analysis results.
 */
function createImprovementTasks(projectId, tasks, source) {
  const db = getDb();
  let count = 0;

  for (const task of tasks) {
    if (!task.title) continue;

    const title = task.title.slice(0, 200);

    // Check for duplicate titles
    const existing = db.prepare(
      'SELECT id FROM tasks WHERE project_id = ? AND title = ?'
    ).get(projectId, title);
    if (existing) continue;

    const id = uuid();
    db.prepare(`
      INSERT INTO tasks (id, project_id, title, description, task_type, tier, priority, model)
      VALUES (?, ?, ?, ?, 'agent', 1, ?, 'sonnet')
    `).run(id, projectId, title,
      `${task.description || ''}\n\nGenerated by Smart Mode (${source})`.trim(),
      task.priority || 5);
    count++;
  }

  return count;
}

/**
 * Pick the best analysis type for a project based on what hasn't been done recently.
 */
function pickAnalysisType(projectId) {
  const db = getDb();
  const recentAnalyses = db.prepare(`
    SELECT title FROM tasks
    WHERE project_id = ? AND title LIKE 'Smart Mode:%' AND created_at > datetime('now', '-7 days')
  `).all(projectId);

  const done = new Set(recentAnalyses.map(t => {
    const match = t.title.match(/Smart Mode: (.+) analysis/);
    return match ? match[1].replace(/ /g, '_') : null;
  }).filter(Boolean));

  const types = Object.keys(ANALYSIS_PROMPTS);
  // Return first type not done this week, or cycle back
  return types.find(t => !done.has(t)) || types[0];
}

/**
 * Main entry point: run Smart Mode on the most suitable project.
 *
 * Cycles through all unpaused projects and finds an analysis type
 * that hasn't been run recently, ensuring systematic coverage.
 */
async function run() {
  const db = getDb();
  const projects = db.prepare("SELECT * FROM projects WHERE paused = 0 ORDER BY priority ASC").all();
  if (!projects.length) {
    log.info('[SmartMode] No projects available');
    return null;
  }

  // Pick a project that hasn't been fully analyzed recently
  for (const project of projects) {
    const recent = db.prepare(`
      SELECT title FROM tasks WHERE project_id = ? AND title LIKE 'Smart Mode:%'
      ORDER BY created_at DESC LIMIT 5
    `).all(project.id);

    const recentTypes = recent.map(t => {
      const match = t.title.match(/Smart Mode: (.+)/);
      return match ? match[1].toLowerCase().replace(/\s+/g, '_') : '';
    });

    // Find an analysis type that hasn't been done recently
    const types = Object.keys(ANALYSIS_PROMPTS);
    const nextType = types.find(t => !recentTypes.includes(t));

    if (nextType) {
      return analyzeProject(project.id, nextType);
    }
  }

  // All types done recently for all projects — fall back to least-recent project
  const fallback = db.prepare(`
    SELECT p.* FROM projects p
    LEFT JOIN (
      SELECT project_id, MAX(created_at) as last_analysis
      FROM tasks WHERE title LIKE 'Smart Mode:%'
      GROUP BY project_id
    ) a ON p.id = a.project_id
    WHERE p.paused = 0
    ORDER BY a.last_analysis ASC NULLS FIRST, p.priority ASC
    LIMIT 1
  `).get();

  if (fallback) {
    const analysisType = pickAnalysisType(fallback.id);
    return analyzeProject(fallback.id, analysisType);
  }

  return null;
}

module.exports = { run, analyzeProject, pickAnalysisType, ANALYSIS_PROMPTS };
