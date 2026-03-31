const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');

const router = Router();

// GET /api/projects/:projectId/memory — get all memories for a project
router.get('/project/:projectId', (req, res) => {
  const db = getDb();
  const memories = db.prepare(
    'SELECT * FROM project_memory WHERE project_id = ? ORDER BY updated_at DESC'
  ).all(req.params.projectId);
  res.json(memories);
});

// GET /api/memory/system — get all system-level memories
router.get('/system', (req, res) => {
  const db = getDb();
  const memories = db.prepare(
    'SELECT * FROM system_memory ORDER BY updated_at DESC'
  ).all();
  res.json(memories);
});

// DELETE /api/memory/:id — delete a project memory
router.delete('/project/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM project_memory WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// DELETE /api/memory/system/:id — delete a system memory
router.delete('/system/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM system_memory WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// GET /api/memory/search/:projectId?q=keyword — search long-term memory
router.get('/search/:projectId', (req, res) => {
  const { searchMemory } = require('../services/memory');
  const results = searchMemory(req.params.projectId, req.query.q || '', 20);
  res.json(results);
});

module.exports = router;
