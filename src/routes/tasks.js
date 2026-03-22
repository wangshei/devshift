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

// PATCH /api/tasks/:id
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const fields = ['title', 'description', 'task_type', 'tier', 'status', 'priority',
    'deadline', 'pre_approved', 'branch_name', 'pr_url', 'pr_number',
    'result_summary', 'review_instructions', 'execution_log', 'model',
    'provider', 'estimated_minutes', 'actual_minutes', 'started_at',
    'completed_at', 'parent_task_id'];
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

// POST /api/tasks/:id/execute — manual trigger (stub for Phase 2)
router.post('/:id/execute', (req, res) => {
  res.status(501).json({ error: 'Execution engine not yet implemented' });
});

module.exports = router;
