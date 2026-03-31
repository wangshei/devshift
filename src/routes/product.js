const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');

const router = Router();

// --- Goals ---
router.get('/:projectId/goals', (req, res) => {
  const db = getDb();
  const goals = db.prepare('SELECT * FROM goals WHERE project_id = ? ORDER BY status, priority ASC').all(req.params.projectId);
  res.json(goals);
});

router.post('/:projectId/goals', (req, res) => {
  const db = getDb();
  const { title, description, metric, target_value, deadline } = req.body;
  const id = uuid();
  db.prepare('INSERT INTO goals (id, project_id, title, description, metric, target_value, deadline) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.projectId, title, description, metric, target_value, deadline);
  res.status(201).json(db.prepare('SELECT * FROM goals WHERE id = ?').get(id));
});

router.patch('/goals/:id', (req, res) => {
  const db = getDb();
  const fields = ['title', 'description', 'metric', 'target_value', 'current_value', 'status', 'deadline'];
  const updates = []; const values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id));
});

router.delete('/goals/:id', (req, res) => {
  getDb().prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Features ---
router.get('/:projectId/features', (req, res) => {
  const db = getDb();
  const features = db.prepare('SELECT * FROM features WHERE project_id = ? ORDER BY status, priority ASC').all(req.params.projectId);
  res.json(features);
});

router.post('/:projectId/features', (req, res) => {
  const db = getDb();
  const { title, description, goal_id, priority, assumptions } = req.body;
  const id = uuid();
  db.prepare('INSERT INTO features (id, project_id, goal_id, title, description, priority, assumptions) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.projectId, goal_id, title, description, priority, assumptions);
  res.status(201).json(db.prepare('SELECT * FROM features WHERE id = ?').get(id));
});

router.patch('/features/:id', (req, res) => {
  const db = getDb();
  const fields = ['title', 'description', 'goal_id', 'status', 'priority', 'assumptions', 'outcome'];
  const updates = []; const values = [];
  for (const f of fields) { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE features SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM features WHERE id = ?').get(req.params.id));
});

router.delete('/features/:id', (req, res) => {
  getDb().prepare('DELETE FROM features WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Ideas ---
router.get('/:projectId/ideas', (req, res) => {
  const db = getDb();
  res.json(db.prepare("SELECT * FROM ideas WHERE project_id = ? ORDER BY status = 'new' DESC, priority ASC").all(req.params.projectId));
});

router.post('/:projectId/ideas', (req, res) => {
  const db = getDb();
  const { title, description, source, priority } = req.body;
  const id = uuid();
  db.prepare('INSERT INTO ideas (id, project_id, title, description, source, priority) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.projectId, title, description, source || 'human', priority || 5);
  res.status(201).json(db.prepare('SELECT * FROM ideas WHERE id = ?').get(id));
});

router.post('/ideas/:id/promote', (req, res) => {
  const db = getDb();
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  const featureId = uuid();
  db.prepare('INSERT INTO features (id, project_id, title, description, priority) VALUES (?, ?, ?, ?, ?)')
    .run(featureId, idea.project_id, idea.title, idea.description, idea.priority);
  db.prepare("UPDATE ideas SET status = 'promoted', promoted_to_feature_id = ? WHERE id = ?")
    .run(featureId, idea.id);
  res.json(db.prepare('SELECT * FROM features WHERE id = ?').get(featureId));
});

router.delete('/ideas/:id', (req, res) => {
  getDb().prepare('DELETE FROM ideas WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Sprints ---
router.get('/:projectId/sprints', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM sprints WHERE project_id = ? ORDER BY start_date DESC').all(req.params.projectId));
});

router.post('/:projectId/sprints', (req, res) => {
  const db = getDb();
  const { title, goal, start_date, end_date } = req.body;
  const id = uuid();
  db.prepare('INSERT INTO sprints (id, project_id, title, goal, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.projectId, title, goal, start_date, end_date);
  res.status(201).json(db.prepare('SELECT * FROM sprints WHERE id = ?').get(id));
});

// --- Agents ---
router.get('/:projectId/agents', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY role').all(req.params.projectId));
});

// --- PM Reports ---
router.get('/:projectId/reports', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM pm_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.projectId));
});

router.get('/reports/unread', (req, res) => {
  const db = getDb();
  const unread = db.prepare('SELECT r.*, p.name as project_name FROM pm_reports r JOIN projects p ON r.project_id = p.id WHERE r.read = 0 ORDER BY r.created_at DESC').all();
  res.json(unread);
});

router.post('/reports/:id/read', (req, res) => {
  getDb().prepare('UPDATE pm_reports SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ read: true });
});

module.exports = router;
