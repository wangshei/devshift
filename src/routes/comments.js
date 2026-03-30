const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');

const router = Router();

// GET /api/tasks/:taskId/comments
router.get('/:taskId/comments', (req, res) => {
  const db = getDb();
  const comments = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(req.params.taskId);
  res.json(comments);
});

// POST /api/tasks/:taskId/comments
router.post('/:taskId/comments', (req, res) => {
  const db = getDb();
  const { content, author } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const id = uuid();
  db.prepare(
    'INSERT INTO task_comments (id, task_id, author, content) VALUES (?, ?, ?, ?)'
  ).run(id, req.params.taskId, author || 'user', content.trim());

  const comment = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
  res.status(201).json(comment);
});

module.exports = router;
