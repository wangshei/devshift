const { v4: uuid } = require('uuid');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { pickProvider } = require('../providers');
const log = require('../utils/logger');
const gitUtils = require('../utils/git');
const github = require('./github');

const MAX_RETRIES = 2;

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
    openai: () => new (require('../providers/openai'))(),
    gemini: () => new (require('../providers/gemini'))(),
  };

  if (!providers[providerId]) return null;
  providerInstances[providerId] = providers[providerId]();
  return providerInstances[providerId];
}

/**
 * Verify task output by running project tests/build.
 * @param {object} project
 * @param {object} task
 * @returns {{ passed: boolean, errors: string }}
 */
function verifyChanges(project, task) {
  const results = [];
  let passed = true;

  // Read package.json to find scripts
  let scripts = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(project.repo_path, 'package.json'), 'utf-8'));
    scripts = pkg.scripts || {};
  } catch { /* no package.json */ }

  // Determine what to run based on available scripts
  // For tier 1 lint/format tasks, run lint. For others, run test then build.
  const checks = [];

  // Always try tests if available (most important signal)
  if (scripts.test) checks.push({ name: 'test', cmd: 'npm test' });
  // Build check for tier 2 tasks
  if (scripts.build && task.tier === 2) checks.push({ name: 'build', cmd: 'npm run build' });
  // Lint check for lint-related tasks
  if (scripts.lint && /lint|format|eslint/i.test(task.title)) checks.push({ name: 'lint', cmd: 'npm run lint' });

  for (const check of checks) {
    try {
      execSync(check.cmd, {
        cwd: project.repo_path,
        encoding: 'utf-8',
        timeout: 120000, // 2 min per check
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      results.push(`${check.name}: PASSED`);
    } catch (e) {
      passed = false;
      const output = (e.stdout || '') + '\n' + (e.stderr || '');
      // Truncate to last 3000 chars to fit in prompt
      results.push(`${check.name}: FAILED\n${output.slice(-3000)}`);
    }
  }

  // If no checks available, just check that there are actual file changes
  if (checks.length === 0) {
    const hasChanges = gitUtils.hasChanges(project.repo_path);
    if (!hasChanges && task.tier !== 3) {
      passed = false;
      results.push('No file changes were made by the agent.');
    }
  }

  return { passed, errors: results.join('\n\n') };
}

/**
 * Retry a failed task with error context so the provider can fix its own mistakes.
 * Uses session resumption when available so the provider has full context of what it already did.
 * @param {object} task
 * @param {object} project
 * @param {object} provider
 * @param {string} errors
 * @param {object} options
 * @param {string|null} sessionId - session ID from previous execution for multi-turn resumption
 * @returns {Promise<object>}
 */
async function retryWithErrors(task, project, provider, errors, options, sessionId) {
  const retryTask = {
    ...task,
    title: `Fix: ${task.title}`,
    description: `The previous attempt produced errors. Fix them.\n\n## Errors to Fix\n${errors}\n\n## Instructions\n- Read the error output carefully.\n- Fix the issues. Do NOT start over — fix what was already done.\n- Run the failing commands again to verify your fixes work.\n- Keep changes minimal — only fix what's broken.`,
  };

  // Resume the same session so Claude has full context of what it already did
  const retryOptions = { ...options };
  if (sessionId) retryOptions.sessionId = sessionId;

  return provider.execute(retryTask, project, retryOptions);
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
  const execOptions = { model: task.model, logPath };
  const result = await provider.execute(task, project, execOptions);
  let sessionId = result.sessionId || null;
  let durationMin = Math.round((Date.now() - startTime) / 60000);

  if (!result.success) {
    // Handle rate limiting — re-queue the task instead of failing it
    if (result.rateLimited) {
      // Use provider's resetsAt if available, otherwise default 5 min backoff
      const backoffUntil = result.resetsAt || new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const resetsIn = Math.max(1, Math.round((new Date(backoffUntil) - Date.now()) / 60000));

      db.prepare('UPDATE providers SET rate_limited_until = ? WHERE id = ?')
        .run(backoffUntil, providerRecord.id);
      log.warn(`Provider ${providerRecord.name} rate limited until ${backoffUntil} (${resetsIn}min)`);

      // Re-queue the task so scheduler picks it up after backoff
      if (mainBranch) {
        try { gitUtils.checkout(project.repo_path, mainBranch); } catch {}
      }
      db.prepare("UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = ?").run(taskId);
      db.prepare("UPDATE executions SET status = 'rate_limited', error = ? WHERE id = ?")
        .run(`Rate limited. Will retry after ${backoffUntil} (~${resetsIn}min)`, execId);
      repoLocks.delete(project.repo_path);
      log.info(`Task "${task.title}" re-queued (retry in ~${resetsIn}min)`);
      return { success: false, taskId, error: 'rate_limited', retryAfter: backoffUntil };
    }

    // Try to go back to main branch
    if (mainBranch) {
      try { gitUtils.checkout(project.repo_path, mainBranch); } catch { /* ignore */ }
    }

    return failTask(db, taskId, execId, project.id,
      result.error || 'Execution failed', result.output, durationMin, project.repo_path);
  }

  // Verify and retry loop — skip for tier 3 (research) tasks
  let verification = { passed: true, errors: '' };
  let retryCount = 0;

  if (task.tier !== 3) {
    verification = verifyChanges(project, task);

    while (!verification.passed && retryCount < MAX_RETRIES) {
      retryCount++;
      log.info(`[Verify] Task "${task.title}" failed verification (attempt ${retryCount}/${MAX_RETRIES}). Retrying with error context...`);

      const retryResult = await retryWithErrors(task, project, provider, verification.errors, execOptions, sessionId);

      if (!retryResult.success) {
        log.warn(`[Verify] Retry ${retryCount} provider execution failed: ${retryResult.error}`);
        break;
      }

      // Update sessionId from retry (same session, but capture in case it changes)
      if (retryResult.sessionId) sessionId = retryResult.sessionId;

      // Append retry output to main result
      result.output += `\n\n--- Retry ${retryCount} ---\n${retryResult.output}`;

      verification = verifyChanges(project, task);
    }

    // Update total duration across all attempts
    durationMin = Math.round((Date.now() - startTime) / 60000);

    if (verification.passed && retryCount > 0) {
      log.info(`[Verify] Task "${task.title}" passed verification after ${retryCount} retry(s)`);
    } else if (!verification.passed) {
      log.warn(`[Verify] Task "${task.title}" still failing after ${retryCount} retries. Committing with needs_review.`);
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

  // Determine final status — force needs_review if verification failed
  const verificationFailed = !verification.passed && task.tier !== 3;
  const finalStatus = verificationFailed ? 'needs_review' : (autoMerge ? 'done' : 'needs_review');

  // Build result summary with verification info
  let resultSummary = result.output.slice(0, 2000);
  if (verification.passed && retryCount === 0 && verification.errors) {
    resultSummary += '\n\nAll checks passed.';
  } else if (verification.passed && retryCount > 0) {
    resultSummary += `\n\nAll checks passed after ${retryCount} retry(s).`;
  }

  // Generate review instructions from reviewer agent or fallback
  let reviewInstructions = autoMerge && !verificationFailed ? null
    : reviewResult?.review || `Review the changes in branch "${branchName}". ${prUrl ? `PR: ${prUrl}` : ''}`;

  // If verification failed, prepend error details so the user knows what's wrong
  if (verificationFailed) {
    reviewInstructions = `**Verification failed after ${retryCount} retry(s):**\n\n${verification.errors}\n\n${reviewInstructions || ''}`;
  }

  // Update task (include session_id for multi-turn resumption / "Take over" button)
  db.prepare(`
    UPDATE tasks SET status = ?, pr_url = ?, pr_number = ?,
      result_summary = ?, review_instructions = ?,
      actual_minutes = ?, completed_at = datetime('now'),
      session_id = ?
    WHERE id = ?
  `).run(finalStatus, prUrl, prNumber,
    resultSummary, reviewInstructions, durationMin, sessionId, taskId);

  // Update execution (include actual cost from provider response)
  const totalCost = (result.cost || 0);
  db.prepare(`
    UPDATE executions SET status = 'completed', completed_at = datetime('now'),
      output = ?, actual_cost_usd = ?
    WHERE id = ?
  `).run(result.output.slice(0, 5000), totalCost || null, execId);

  // Learn from this task outcome
  try {
    const { learnFromTask } = require('./memory');
    learnFromTask(taskId);
  } catch (e) {
    log.debug(`[Memory] Could not learn from task: ${e.message}`);
  }

  log.info(`Task "${task.title}" completed → ${finalStatus} (${durationMin}min)`);

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

  // Learn from failure
  try {
    const { learnFromTask } = require('./memory');
    learnFromTask(taskId);
  } catch {}

  // Auto-retry: re-queue if this is the first failure (not a rate limit, not already retried)
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (task && !error.includes('rate_limited')) {
    // Count how many times this task has been executed
    const execCount = db.prepare(
      'SELECT COUNT(*) as c FROM executions WHERE task_id = ?'
    ).get(taskId);

    if (execCount.c <= 1) {
      // First failure — re-queue with updated description noting the failure
      const retryNote = `\n\n---\n**Previous attempt failed:** ${error.slice(0, 500)}\nThe system has learned from this failure. Try a different approach.`;
      db.prepare(
        "UPDATE tasks SET status = 'queued', description = COALESCE(description, '') || ? WHERE id = ?"
      ).run(retryNote, taskId);
      log.info(`[AutoRetry] Re-queued task "${task.title}" after first failure (learning applied)`);
    }
  }

  return { success: false, taskId, error };
}

/**
 * Run a reviewer agent on the changes — a second Claude pass that checks the work.
 * Returns { review, issues, approved } or null if review fails.
 */
async function runReviewer(project, branchName, task, providerRecord) {
  // Only use Claude Code for reviews
  if (providerRecord.id !== 'claude_code') return null;

  // Check provider is enabled
  try {
    const db = getDb();
    const provider = db.prepare("SELECT * FROM providers WHERE id = 'claude_code' AND enabled = 1").get();
    if (!provider) return null;
  } catch {}

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
      `claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet --effort low`,
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
