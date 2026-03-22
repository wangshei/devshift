const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const { pickProvider } = require('../providers');
const log = require('../utils/logger');
const gitUtils = require('../utils/git');
const github = require('./github');

// Provider class instances (lazy-loaded)
const providerInstances = {};

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

  // Mark as in_progress
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?").run(now, taskId);

  // Create execution record
  const execId = uuid();
  const providerRecord = task.provider
    ? db.prepare('SELECT * FROM providers WHERE id = ?').get(task.provider)
    : pickProvider(task.tier);

  if (!providerRecord) {
    return failTask(db, taskId, execId, project.id, 'No available provider');
  }

  const provider = getProviderInstance(providerRecord.id);
  if (!provider) {
    return failTask(db, taskId, execId, project.id, `Provider ${providerRecord.id} not implemented`);
  }

  db.prepare(`
    INSERT INTO executions (id, task_id, project_id, started_at, status, provider, model)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(execId, taskId, project.id, now, providerRecord.id, task.model);

  log.info(`Executing task "${task.title}" via ${providerRecord.name}`);

  // Create a branch for this task
  const branchName = `devshift/${task.id.slice(0, 8)}-${slugify(task.title)}`;
  let mainBranch;
  try {
    mainBranch = gitUtils.currentBranch(project.repo_path);
    gitUtils.createBranch(project.repo_path, branchName);
    db.prepare('UPDATE tasks SET branch_name = ? WHERE id = ?').run(branchName, taskId);
  } catch (e) {
    log.warn(`Could not create branch: ${e.message}. Working on current branch.`);
  }

  // Execute the task
  const startTime = Date.now();
  const result = await provider.execute(task, project, { model: task.model });
  const durationMin = Math.round((Date.now() - startTime) / 60000);

  if (!result.success) {
    // Handle rate limiting
    if (result.rateLimited) {
      const backoffUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      db.prepare('UPDATE providers SET rate_limited_until = ? WHERE id = ?')
        .run(backoffUntil, providerRecord.id);
      log.warn(`Provider ${providerRecord.name} rate limited until ${backoffUntil}`);
    }

    // Try to go back to main branch
    if (mainBranch) {
      try { gitUtils.checkout(project.repo_path, mainBranch); } catch { /* ignore */ }
    }

    return failTask(db, taskId, execId, project.id,
      result.error || 'Execution failed', result.output, durationMin);
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

  // Push and create PR for tier 2+ tasks, auto-merge for tier 1 or pre-approved
  let prUrl = null;
  let prNumber = null;
  const autoMerge = task.tier === 1 || task.pre_approved;

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

  // Generate review instructions for non-auto tasks
  const reviewInstructions = autoMerge ? null
    : `Review the changes in branch "${branchName}". ${prUrl ? `PR: ${prUrl}` : ''}`;

  // Update task
  db.prepare(`
    UPDATE tasks SET status = ?, pr_url = ?, pr_number = ?,
      result_summary = ?, review_instructions = ?,
      actual_minutes = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(finalStatus, prUrl, prNumber,
    result.output.slice(0, 2000), reviewInstructions, durationMin, taskId);

  // Update execution
  db.prepare(`
    UPDATE executions SET status = 'completed', completed_at = datetime('now'),
      output = ?
    WHERE id = ?
  `).run(result.output.slice(0, 5000), execId);

  log.info(`Task "${task.title}" completed → ${finalStatus} (${durationMin}min)`);

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

function failTask(db, taskId, execId, projectId, error, output = '', durationMin = 0) {
  db.prepare("UPDATE tasks SET status = 'failed', execution_log = ?, actual_minutes = ? WHERE id = ?")
    .run(error, durationMin, taskId);
  db.prepare("UPDATE executions SET status = 'failed', error = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
    .run(error, output || '', execId);
  log.error(`Task ${taskId} failed: ${error}`);
  return { success: false, taskId, error };
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

module.exports = { executeTask };
