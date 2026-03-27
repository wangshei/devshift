const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const { pickProvider } = require('../providers');
const log = require('../utils/logger');
const gitUtils = require('../utils/git');
const github = require('./github');

// Provider class instances (lazy-loaded)
const providerInstances = {};

// Per-repo execution lock — prevents two tasks running on the same repo simultaneously
const repoLocks = new Set();

function getProviderInstance(providerId) {
  if (providerInstances[providerId]) return providerInstances[providerId];

  const providers = {
    claude_code: () => new (require('../providers/claude-code'))(),
    antigravity: () => new (require('../providers/antigravity'))(),
    cursor: () => new (require('../providers/cursor'))(),
  };

  if (!providers[providerId]) return null;
  providerInstances[providerId] = providers[providerId]();
  return providerInstances[providerId];
}

/**
 * Execute a single task through the full pipeline:
 * 1. Pick provider
 * 2. Create branch
 * 3. Execute via provider
 * 4. Commit changes
 * 5. Push + create PR (or auto-merge for tier 1)
 * 6. Update task status
 */
async function executeTask(taskId) {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) throw new Error(`Project ${task.project_id} not found`);

  // Acquire repo lock — prevent concurrent execution on same repo
  if (repoLocks.has(project.repo_path)) {
    log.warn(`Repo ${project.repo_path} is locked — skipping task "${task.title}"`);
    return { success: false, taskId, error: 'Repo is busy with another task' };
  }
  repoLocks.add(project.repo_path);

  // Mark as in_progress
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?").run(now, taskId);

  // Create execution record
  const execId = uuid();
  const providerRecord = task.provider
    ? db.prepare('SELECT * FROM providers WHERE id = ?').get(task.provider)
    : pickProvider(task.tier);

  if (!providerRecord) {
    return failTask(db, taskId, execId, project.id, 'No available provider', '', 0, project.repo_path);
  }

  const provider = getProviderInstance(providerRecord.id);
  if (!provider) {
    return failTask(db, taskId, execId, project.id, `Provider ${providerRecord.id} not implemented`, '', 0, project.repo_path);
  }

  const logPath = require('path').join(require('../utils/config').DATA_DIR || 'data', `exec-${execId}.log`);

  db.prepare(`
    INSERT INTO executions (id, task_id, project_id, started_at, status, provider, model, log_path)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(execId, taskId, project.id, now, providerRecord.id, task.model, logPath);

  log.info(`Executing task "${task.title}" via ${providerRecord.name}`);

  // Fetch latest from remote if available
  if (project.github_remote) {
    try {
      gitUtils.fetch(project.repo_path);
      // Pull latest on main/master
      const currentBranch = gitUtils.currentBranch(project.repo_path);
      if (currentBranch === 'main' || currentBranch === 'master') {
        gitUtils.pull(project.repo_path);
      }
    } catch (e) {
      log.warn(`Could not fetch latest: ${e.message}`);
    }
  }

  // Create a branch for this task — always start from main/master
  const branchName = `devshift/${task.id.slice(0, 8)}-${slugify(task.title)}`;
  let mainBranch;
  try {
    // Find the default branch (main or master)
    mainBranch = gitUtils.currentBranch(project.repo_path);
    if (mainBranch.startsWith('devshift/')) {
      // We're on a devshift branch — go back to main first
      try { gitUtils.checkout(project.repo_path, 'main'); mainBranch = 'main'; }
      catch { try { gitUtils.checkout(project.repo_path, 'master'); mainBranch = 'master'; } catch { /* stay where we are */ } }
    }
    gitUtils.createBranch(project.repo_path, branchName);
    db.prepare('UPDATE tasks SET branch_name = ? WHERE id = ?').run(branchName, taskId);
  } catch (e) {
    log.warn(`Could not create branch: ${e.message}. Working on current branch.`);
  }

  // Execute the task
  const startTime = Date.now();
  let result = await provider.execute(task, project, { model: task.model, logPath });
  const durationMin = Math.round((Date.now() - startTime) / 60000);

  if (!result.success) {
    // Handle rate limiting
    if (result.rateLimited) {
      const backoffUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      db.prepare('UPDATE providers SET rate_limited_until = ? WHERE id = ?')
        .run(backoffUntil, providerRecord.id);
      log.warn(`Provider ${providerRecord.name} rate limited until ${backoffUntil}`);
    }

    // Try fallback provider (different from the one that just failed)
    if (!result.rateLimited) {
      const { pickProvider: pickFallback } = require('../providers');
      const fallbackProvider = pickFallback(task.tier, providerRecord.id);
      if (fallbackProvider && fallbackProvider.id !== providerRecord.id) {
        log.info(`[Executor] Retrying "${task.title}" with fallback provider ${fallbackProvider.name}`);
        const fallbackInstance = getProviderInstance(fallbackProvider.id);
        if (fallbackInstance) {
          const retryResult = await fallbackInstance.execute(task, project, { model: task.model, logPath });
          if (retryResult.success) {
            db.prepare('UPDATE executions SET provider = ? WHERE id = ?').run(fallbackProvider.id, execId);
            result = retryResult;
          }
        }
      }
    }

    // If still not successful after fallback attempt, fail the task
    if (!result.success) {
      // Try to go back to main branch
      if (mainBranch) {
        try { gitUtils.checkout(project.repo_path, mainBranch); } catch { /* ignore */ }
      }

      return failTask(db, taskId, execId, project.id,
        result.error || 'Execution failed', result.output, durationMin, project.repo_path);
    }
  }

  // Commit any changes
  let commitHash = null;
  try {
    if (gitUtils.hasChanges(project.repo_path)) {
      commitHash = gitUtils.commitAll(project.repo_path,
        `devshift: ${task.title}\n\nAutomated by DevShift via ${providerRecord.name}`);
    }
  } catch (e) {
    log.warn(`Could not commit: ${e.message}`);
  }

  // Run reviewer agent on the changes
  let reviewResult = null;
  if (commitHash) {
    reviewResult = await runReviewer(project, branchName, task, providerRecord);
  }

  // Push and create PR for tier 2+ tasks, auto-merge for tier 1 or pre-approved
  let prUrl = null;
  let prNumber = null;
  // Check project-level auto-approve config
  const approvedTiers = (project.auto_approve_tiers || '1').split(',').map(Number);
  const autoMerge = approvedTiers.includes(task.tier) || task.pre_approved;

  if (commitHash && project.github_remote) {
    try {
      gitUtils.push(project.repo_path, branchName);

      if (!autoMerge) {
        const pr = github.createPR({
          repoPath: project.repo_path,
          title: `[DevShift] ${task.title}`,
          body: `Automated task executed by DevShift.\n\n**Summary:** ${result.output.slice(0, 500)}`,
          head: branchName,
          base: mainBranch || 'main',
        });
        if (pr) {
          prUrl = pr.url;
          prNumber = pr.number;
        }
      }
    } catch (e) {
      log.warn(`Could not push/PR: ${e.message}`);
    }
  }

  // Go back to main
  if (mainBranch) {
    try { gitUtils.checkout(project.repo_path, mainBranch); } catch { /* ignore */ }
  }

  // Determine final status
  const finalStatus = autoMerge ? 'done' : 'needs_review';

  // Generate review instructions from reviewer agent or fallback
  const reviewInstructions = autoMerge ? null
    : reviewResult?.review || `Review the changes in branch "${branchName}". ${prUrl ? `PR: ${prUrl}` : ''}`;

  // Update task
  db.prepare(`
    UPDATE tasks SET status = ?, pr_url = ?, pr_number = ?,
      result_summary = ?, review_instructions = ?,
      actual_minutes = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(finalStatus, prUrl, prNumber,
    result.output.slice(0, 2000), reviewInstructions, durationMin, taskId);

  // Update execution
  const { estimateCreditCost } = require('./planner');
  const creditCost = estimateCreditCost(task);
  db.prepare(`
    UPDATE executions SET status = 'completed', completed_at = datetime('now'),
      output = ?, estimated_credits = ?
    WHERE id = ?
  `).run(result.output.slice(0, 5000), creditCost, execId);

  log.info(`Task "${task.title}" completed → ${finalStatus} (${durationMin}min)`);

  // --- PM DEBRIEF: analyze what was done, suggest next steps ---
  // Run async so it doesn't block the scheduler
  generateDebrief(taskId, task, project, result.output, providerRecord).catch(e => {
    log.warn(`[PM Debrief] Failed for task ${taskId}: ${e.message}`);
  });

  repoLocks.delete(project.repo_path);
  return {
    success: true,
    taskId,
    status: finalStatus,
    provider: providerRecord.name,
    duration: durationMin,
    prUrl,
    output: result.output,
  };
}

function failTask(db, taskId, execId, projectId, error, output = '', durationMin = 0, repoPath = null) {
  if (repoPath) repoLocks.delete(repoPath);
  db.prepare("UPDATE tasks SET status = 'failed', execution_log = ?, actual_minutes = ? WHERE id = ?")
    .run(error, durationMin, taskId);
  db.prepare("UPDATE executions SET status = 'failed', error = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
    .run(error, output || '', execId);
  log.error(`Task ${taskId} failed: ${error}`);

  // Async failure analysis (don't block)
  generateFailureAnalysis(taskId,
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId),
    db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId),
    error, null
  ).catch(() => {});

  return { success: false, taskId, error };
}

async function generateFailureAnalysis(taskId, task, project, error, providerRecord) {
  const { spawnSync } = require('child_process');
  const db = getDb();

  // Check for repeated failures on similar tasks
  const similarFailures = db.prepare(`
    SELECT title, execution_log, debrief FROM tasks
    WHERE project_id = ? AND status = 'failed' AND id != ?
    ORDER BY completed_at DESC LIMIT 5
  `).all(task.project_id, taskId);

  const failureContext = similarFailures.length > 0
    ? `\n\nPrevious failures on this project:\n${similarFailures.map(f => `- "${f.title}": ${f.execution_log?.slice(0, 100)}`).join('\n')}`
    : '';

  const prompt = `A coding task just FAILED. Analyze why and how to prevent this in the future.

Task: "${task.title}"
Project: ${project.name}
Provider: ${providerRecord?.name || 'unknown'}
Error: ${error.slice(0, 1000)}
${failureContext}

Respond in JSON:
{
  "debrief": "What went wrong in 2-3 sentences. Be specific about the root cause.",
  "lesson": "A rule that would prevent this in the future (e.g., 'Always check if the database migration exists before running queries')",
  "retry_suggestion": "Should this be retried? If yes, what should change? If no, why?",
  "is_recurring": ${similarFailures.length > 0 ? 'true or false — is this the same type of failure as previous ones?' : 'false'}
}

Output ONLY valid JSON.`;

  try {
    const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
      cwd: project.repo_path,
      input: prompt,
      encoding: 'utf-8',
      timeout: 45000,
    });

    if (result.error || result.status !== 0) return;

    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      db.prepare('UPDATE tasks SET debrief = ? WHERE id = ?').run(result.stdout.slice(0, 1000), taskId);
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Save debrief to the failed task
    const debrief = [
      parsed.debrief,
      parsed.lesson ? `\n**Lesson:** ${parsed.lesson}` : '',
      parsed.retry_suggestion ? `\n**Retry:** ${parsed.retry_suggestion}` : '',
      parsed.is_recurring ? '\n**Warning:** This is a recurring failure pattern.' : '',
    ].join('');

    db.prepare('UPDATE tasks SET debrief = ? WHERE id = ?').run(debrief, taskId);

    // If there's a lesson, add it to project preferences so future tasks avoid it
    if (parsed.lesson) {
      const project2 = db.prepare('SELECT preferences FROM projects WHERE id = ?').get(task.project_id);
      let prefs = [];
      try { prefs = JSON.parse(project2.preferences || '[]'); } catch {}
      if (Array.isArray(prefs) && !prefs.includes(parsed.lesson)) {
        prefs.push(parsed.lesson);
        db.prepare('UPDATE projects SET preferences = ? WHERE id = ?')
          .run(JSON.stringify(prefs), task.project_id);
      }
    }

    log.info(`[PM Failure] Analyzed failure for "${task.title}": ${parsed.debrief?.slice(0, 100)}`);
  } catch (e) {
    log.warn(`[PM Failure] Analysis failed: ${e.message}`);
  }
}

/**
 * Run a reviewer agent on the changes — a second Claude pass that checks the work.
 * Returns { review, issues, approved } or null if review fails.
 */
async function runReviewer(project, branchName, task, providerRecord) {
  // Only use Claude Code for reviews
  if (providerRecord.id !== 'claude_code') return null;

  const gitUtils = require('../utils/git');
  let diff;
  try {
    const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
    diff = gitUtils.branchDiff(project.repo_path, branchName, defaultBranch);
  } catch { return null; }

  if (!diff || diff.length < 10) return null;

  log.info(`[Reviewer] Reviewing changes for "${task.title}"`);

  const prompt = `You are a code reviewer. A coding agent just completed this task:
"${task.title}"

Here is the diff of changes:

\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`

Review the changes and respond with JSON only:
{
  "approved": true or false,
  "summary": "1-2 sentence summary of what was done",
  "issues": ["list of issues if any, empty array if none"],
  "what_to_check": "specific thing the human should verify"
}`;

  try {
    const { execSync } = require('child_process');
    const output = execSync(
      `claude -p ${JSON.stringify(prompt)} --output-format text --permission-mode bypassPermissions`,
      { cwd: project.repo_path, encoding: 'utf-8', timeout: 60000 }
    );

    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const review = JSON.parse(jsonMatch[0]);
      log.info(`[Reviewer] ${review.approved ? 'Approved' : 'Issues found'}: ${review.summary}`);
      return {
        review: `${review.summary}\n\nCheck: ${review.what_to_check}${review.issues?.length ? '\n\nIssues: ' + review.issues.join(', ') : ''}`,
        approved: review.approved,
        issues: review.issues || [],
      };
    }
  } catch (e) {
    log.warn(`[Reviewer] Review failed: ${e.message}`);
  }
  return null;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

module.exports = { executeTask };

async function generateDebrief(taskId, task, project, output, providerRecord) {
  const { spawnSync } = require('child_process');
  const db = getDb();

  const prompt = `You just completed a coding task. Analyze what was done and suggest next steps.

Task: "${task.title}"
${task.description ? `Description: ${task.description}` : ''}
Project: ${project.name}
Provider: ${providerRecord.name}

Output summary (what the agent did):
${output.slice(0, 3000)}

Respond in this exact JSON format:
{
  "debrief": "2-3 sentence summary of what was accomplished, what changed, and any issues noticed",
  "suggestions": [
    {"title": "short task title", "description": "why this should be done next", "tier": 1},
    {"title": "another task", "description": "reason", "tier": 2}
  ]
}

Rules for suggestions:
- Only suggest tasks that logically follow from what was just done
- Be specific — reference actual files/functions if you can
- Tier 1 = simple/auto (tests, lint, formatting), Tier 2 = features, Tier 3 = research
- Max 3 suggestions
- If nothing needs follow-up, return empty suggestions array
- Output ONLY valid JSON, nothing else`;

  const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
    cwd: project.repo_path,
    input: prompt,
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    log.warn(`[PM Debrief] Claude call failed: ${result.error?.message || result.stderr}`);
    return;
  }

  const text = result.stdout.trim();

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // If not JSON, use the raw text as debrief
    db.prepare('UPDATE tasks SET debrief = ? WHERE id = ?').run(text.slice(0, 2000), taskId);
    return;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Save debrief to the completed task
    if (parsed.debrief) {
      db.prepare('UPDATE tasks SET debrief = ? WHERE id = ?').run(parsed.debrief, taskId);
    }

    // Create suggested tasks
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
      const { v4: uuid } = require('uuid');
      for (const suggestion of parsed.suggestions.slice(0, 3)) {
        if (!suggestion.title) continue;
        db.prepare(`
          INSERT INTO tasks (id, project_id, title, description, task_type, tier, status, priority, parent_task_id)
          VALUES (?, ?, ?, ?, 'agent', ?, 'suggested', 10, ?)
        `).run(
          uuid(),
          task.project_id,
          suggestion.title,
          suggestion.description || null,
          suggestion.tier || 2,
          taskId
        );
      }
      log.info(`[PM Debrief] Created ${parsed.suggestions.length} suggested tasks for "${task.title}"`);
    }
  } catch (e) {
    // JSON parse failed — save raw text as debrief
    db.prepare('UPDATE tasks SET debrief = ? WHERE id = ?').run(text.slice(0, 2000), taskId);
    log.warn(`[PM Debrief] JSON parse failed: ${e.message}`);
  }
}
