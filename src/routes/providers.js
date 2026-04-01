const { Router } = require('express');
const { getDb } = require('../db');
const { detectProviders, getProviders } = require('../providers');

const router = Router();

// GET /api/providers — list all providers
router.get('/', (req, res) => {
  const providers = getProviders().map(p => ({
    ...p,
    api_key: p.api_key ? '••••' + p.api_key.slice(-4) : null,
  }));
  res.json(providers);
});

// POST /api/providers/detect — auto-detect installed tools
router.post('/detect', (req, res) => {
  const results = detectProviders();
  res.json(results);
});

// PATCH /api/providers/:id — update provider config
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Provider not found' });

  const fields = ['enabled', 'cli_command', 'auth_status', 'plan_tier',
    'use_for_tiers', 'priority', 'rate_limited_until', 'api_key'];
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
  db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id);
  res.json(provider);
});

module.exports = router;
