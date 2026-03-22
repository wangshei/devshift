const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');

const router = Router();

// GET /api/changelog
router.get('/', (req, res) => {
  const db = getDb();
  const { project_id } = req.query;

  let sql = 'SELECT * FROM changelog';
  const params = [];

  if (project_id) {
    sql += ' WHERE project_id = ?';
    params.push(project_id);
  }

  sql += ' ORDER BY timestamp DESC LIMIT 50';
  const entries = db.prepare(sql).all(...params);
  res.json(entries);
});

// POST /api/changelog/:id/rollback — revert to a rollback point
router.post('/:id/rollback', (req, res) => {
  const db = getDb();
  const entry = db.prepare('SELECT * FROM changelog WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Changelog entry not found' });

  if (!entry.rollback_tag) {
    return res.status(400).json({ error: 'No rollback tag for this entry' });
  }

  // The actual git revert would happen here via git utils
  // For safety, we just return the tag info — the user can run the revert manually
  res.json({
    message: `To rollback, run: git revert --no-commit ${entry.rollback_tag}..HEAD`,
    rollback_tag: entry.rollback_tag,
    entry,
  });
});

module.exports = router;
