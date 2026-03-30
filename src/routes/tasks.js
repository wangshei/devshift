const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const { classify } = require('../services/classifier');

const router = Router();

// GET /api/tasks
router.get('/', (req, res) => {
  const db = getDb();
  const { project_id, status, task_type } = req.query;

  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];

  if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (task_type) { sql += ' AND task_type = ?'; params.push(task_type); }

  sql += ' ORDER BY priority ASC, created_at DESC';

  const tasks = db.prepare(sql).all(...params);
  res.json(tasks);
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST /api/tasks
router.post('/', (req, res) => {
  const db = getDb();
  const { project_id, title, description, task_type, tier, priority, deadline,
    pre_approved, model, provider, estimated_minutes } = req.body;

  if (!project_id || !title) {
    return res.status(400).json({ error: 'project_id and title are required' });
  }

  // Verify project exists
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
  if (!project) return res.status(400).json({ error: 'Project not found' });

  // Auto-classify if not explicitly set
  const classification = classify(title, description);
  const finalType = task_type || classification.task_type;
  const finalTier = tier ?? classification.tier;
  const finalModel = model || classification.model;

  const id = uuid();
  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, task_type, tier, priority,
      deadline, pre_approved, model, provider, estimated_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project_id, title, description || null, finalType, finalTier,
    priority || 5, deadline || null, pre_approved ? 1 : 0,
    finalModel, provider || 'claude_code', estimated_minutes || null);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(task);
});

// POST /api/tasks/:id/start-work — human starts working on a task
router.post('/:id/start-work', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const workerName = req.body.worker || 'human';

  // Create a branch if one doesn't exist
  let branchName = task.branch_name;
  if (!branchName) {
    const gitUtils = require('../utils/git');
    try {
      const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      branchName = `devshift/${task.id.slice(0, 8)}-${slugify(task.title)}`;
      const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
      gitUtils.checkout(project.repo_path, defaultBranch);
      gitUtils.createBranch(project.repo_path, branchName);
    } catch (e) {
      // Branch might already exist, that's ok
    }
  }

  // Mark task as in_progress with human worker
  db.prepare(`
    UPDATE tasks SET status = 'in_progress', worker = ?, branch_name = ?,
      started_at = COALESCE(started_at, datetime('now'))
    WHERE id = ?
  `).run(workerName, branchName, req.params.id);

  // Open terminal with Claude session
  const { exec } = require('child_process');

  // Build a contextual prompt for the human's Claude session
  const contextPrompt = `You are helping a developer work on this task:

Task: ${task.title}
${task.description ? 'Description: ' + task.description : ''}

The developer is working interactively. Help them with whatever they need.
Read relevant files, suggest changes, run tests — follow their lead.`;

  const sessionId = task.session_id;
  const claudeCmd = sessionId
    ? `claude --resume ${sessionId}`
    : `claude -p ${JSON.stringify(contextPrompt).replace(/'/g, "'\\''")} --permission-mode bypassPermissions`;

  // Try Terminal.app, fallback to iTerm2
  const script = `
    tell application "Terminal"
      activate
      do script "cd ${JSON.stringify(project.repo_path).slice(1, -1)} && ${claudeCmd}"
    end tell
  `;

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) {
      const itermScript = `
        tell application "iTerm2"
          activate
          create window with default profile
          tell current session of current window
            write text "cd ${project.repo_path.replace(/"/g, '\\"')} && ${claudeCmd}"
          end tell
        end tell
      `;
      exec(`osascript -e '${itermScript.replace(/'/g, "'\\''")}'`, (err2) => {
        if (err2) {
          return res.json({
            started: true, branchName,
            manualCommand: `cd "${project.repo_path}" && ${claudeCmd}`,
            error: 'Could not open terminal automatically'
          });
        }
        res.json({ started: true, terminal: 'iTerm2', branchName });
      });
      return;
    }
    res.json({ started: true, terminal: 'Terminal.app', branchName });
  });
});

// POST /api/tasks/:id/handoff — human hands off task to agent
router.post('/:id/handoff', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  const note = req.body.note || '';
  const markDone = req.body.done === true;

  if (markDone) {
    // Human finished the task
    db.prepare(`
      UPDATE tasks SET status = 'done', worker = 'human',
        result_summary = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(note || 'Completed by human', req.params.id);

    // Learn from it
    try {
      const { addProjectMemory, PROJECT_CATEGORIES } = require('../services/memory');
      addProjectMemory(task.project_id, PROJECT_CATEGORIES.COMPLETED,
        `Human completed: ${task.title}${note ? '. Note: ' + note : ''}`, task.id);
    } catch {}

    res.json({ handedOff: false, completed: true });
  } else {
    // Human is handing off to agent to continue
    // Detect any new commits the human made
    let humanWork = '';
    if (task.branch_name && project) {
      try {
        const gitUtils = require('../utils/git');
        const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
        const diff = gitUtils.branchDiffStat(project.repo_path, task.branch_name, defaultBranch);
        if (diff) humanWork = `\n\nHuman made these changes so far:\n${diff}`;
      } catch {}
    }

    // Append handoff context to description
    const handoffNote = `\n\n---\n**Handoff from human:**${note ? ' ' + note : ' Continue from where I left off.'}${humanWork}`;

    db.prepare(`
      UPDATE tasks SET status = 'queued', worker = 'agent',
        description = COALESCE(description, '') || ?
      WHERE id = ?
    `).run(handoffNote, req.params.id);

    // Store handoff in memory
    try {
      const { addProjectMemory, PROJECT_CATEGORIES } = require('../services/memory');
      addProjectMemory(task.project_id, PROJECT_CATEGORIES.CONTEXT,
        `Human handed off "${task.title}": ${note || 'continue from where they left off'}${humanWork ? '. Changes: ' + humanWork.slice(0, 200) : ''}`,
        task.id);
    } catch {}

    res.json({ handedOff: true, completed: false });
  }
});

// POST /api/tasks/log-work — record manually completed work
router.post('/log-work', (req, res) => {
  const db = getDb();
  const { project_id, title, description } = req.body;
  if (!project_id || !title) {
    return res.status(400).json({ error: 'project_id and title required' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, task_type, tier, status,
      result_summary, completed_at)
    VALUES (?, ?, ?, ?, 'human', 1, 'done', ?, datetime('now'))
  `).run(id, project_id, title, description || null, title);

  // Learn from this human work
  try {
    const { addProjectMemory, PROJECT_CATEGORIES } = require('../services/memory');
    addProjectMemory(project_id, PROJECT_CATEGORIES.COMPLETED, `Human completed: ${title}`, id);
    if (description) {
      addProjectMemory(project_id, PROJECT_CATEGORIES.CONTEXT, `Human work context: ${description.slice(0, 300)}`, id);
    }
  } catch {}

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(task);
});

// PATCH /api/tasks/:id
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const fields = ['title', 'description', 'task_type', 'tier', 'status', 'priority',
    'deadline', 'pre_approved', 'branch_name', 'pr_url', 'pr_number',
    'result_summary', 'review_instructions', 'execution_log', 'model',
    'provider', 'estimated_minutes', 'actual_minutes', 'started_at',
    'completed_at', 'parent_task_id', 'session_id'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(task);
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// POST /api/tasks/:id/execute — manual trigger
router.post('/:id/execute', async (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  try {
    const { executeTask } = require('../services/executor');
    const result = await executeTask(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tasks/:id/log — returns the live execution log
router.get('/:id/log', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  // Find most recent execution for this task
  const exec = db.prepare("SELECT * FROM executions WHERE task_id = ? ORDER BY started_at DESC LIMIT 1").get(req.params.id);
  if (!exec?.log_path) return res.json({ log: '', streaming: false });

  const fs = require('fs');
  if (!fs.existsSync(exec.log_path)) return res.json({ log: '', streaming: false });

  const log = fs.readFileSync(exec.log_path, 'utf-8');
  const streaming = task.status === 'in_progress';
  res.json({ log: log.slice(-8000), streaming, execId: exec.id }); // last 8KB
});

// GET /api/tasks/:id/diff — get the diff for a completed task's branch
router.get('/:id/diff', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.branch_name) return res.json({ diff: '', stat: '', error: 'No branch' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const gitUtils = require('../utils/git');
  try {
    const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
    const diff = gitUtils.branchDiff(project.repo_path, task.branch_name, defaultBranch);
    const stat = gitUtils.branchDiffStat(project.repo_path, task.branch_name, defaultBranch);
    res.json({ diff, stat, branch: task.branch_name, baseBranch: defaultBranch });
  } catch (e) {
    res.json({ diff: '', stat: '', error: e.message });
  }
});

// POST /api/tasks/:id/approve — merge the task branch into main
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!task.branch_name) return res.status(400).json({ error: 'No branch to merge' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const gitUtils = require('../utils/git');
  try {
    const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
    gitUtils.checkout(project.repo_path, defaultBranch);
    gitUtils.mergeBranch(project.repo_path, task.branch_name);
    gitUtils.deleteBranch(project.repo_path, task.branch_name);

    db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);

    res.json({ merged: true, branch: task.branch_name, into: defaultBranch });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tasks/:id/dismiss — mark research/analysis task as done without merging
router.post('/:id/dismiss', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Clean up branch if it exists
  if (task.branch_name) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
    if (project) {
      const gitUtils = require('../utils/git');
      try {
        const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
        gitUtils.checkout(project.repo_path, defaultBranch);
        gitUtils.deleteBranch(project.repo_path, task.branch_name);
      } catch { /* branch may not exist */ }
    }
  }

  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);
  res.json({ dismissed: true });
});

// POST /api/tasks/:id/takeover — open Claude session in terminal for manual control
router.post('/:id/takeover', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Get session_id from column (preferred) or fallback to execution_log
  const sessionId = task.session_id
    || ((task.execution_log || '').match(/__session_id__:([\w-]+)/) || [])[1];
  if (!sessionId) {
    return res.status(400).json({ error: 'No session found for this task. The task may not have been executed yet.' });
  }
  const repoPath = project.repo_path;

  // Open Terminal.app with claude --resume
  const { exec } = require('child_process');
  const script = `
    tell application "Terminal"
      activate
      do script "cd ${JSON.stringify(repoPath).slice(1, -1)} && claude --resume ${sessionId}"
    end tell
  `;

  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
    if (err) {
      // Fallback: try iTerm2
      const itermScript = `
        tell application "iTerm2"
          activate
          create window with default profile
          tell current session of current window
            write text "cd ${repoPath.replace(/"/g, '\\"')} && claude --resume ${sessionId}"
          end tell
        end tell
      `;
      exec(`osascript -e '${itermScript.replace(/'/g, "'\\''")}'`, (err2) => {
        if (err2) {
          return res.status(500).json({ error: 'Could not open terminal. Try running manually: claude --resume ' + sessionId });
        }
        res.json({ opened: true, terminal: 'iTerm2', sessionId });
      });
      return;
    }
    res.json({ opened: true, terminal: 'Terminal.app', sessionId });
  });
});

// POST /api/tasks/:id/approve-plan — approve PM decomposition plan
router.post('/:id/approve-plan', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Mark parent as approved, queue all subtasks for execution
  db.prepare("UPDATE tasks SET plan_status = 'approved' WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE tasks SET status = 'queued' WHERE parent_task_id = ? AND status = 'backlog'")
    .run(req.params.id);

  res.json({ approved: true });
});

// POST /api/tasks/:id/revise-plan — user edited subtasks, re-queue
router.post('/:id/revise-plan', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare("UPDATE tasks SET plan_status = 'revised' WHERE id = ?").run(req.params.id);
  // Subtasks stay in backlog — user can delete/edit/add before approving
  res.json({ revised: true });
});

// POST /api/tasks/:id/reject — delete the task branch, mark as failed
router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);

  if (task.branch_name && project) {
    const gitUtils = require('../utils/git');
    try {
      const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
      gitUtils.checkout(project.repo_path, defaultBranch);
      gitUtils.deleteBranch(project.repo_path, task.branch_name);
    } catch { /* branch may not exist */ }
  }

  db.prepare("UPDATE tasks SET status = 'failed', execution_log = 'Rejected by user' WHERE id = ?").run(task.id);
  res.json({ rejected: true });
});

module.exports = router;
