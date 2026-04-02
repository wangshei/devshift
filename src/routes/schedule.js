const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

// GET /api/schedule
router.get('/', (req, res) => {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  res.json(schedule);
});

// PATCH /api/schedule
router.patch('/', (req, res) => {
  const db = getDb();
  const fields = ['timezone', 'active_hours_start', 'active_hours_end', 'active_days',
    'vacation_mode', 'vacation_until', 'off_today', 'primary_provider',
    'max_tasks_per_window', 'reserve_percent', 'telegram_bot_token', 'telegram_chat_id', 'always_on', 'last_checkin', 'blocked_slots'];
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

  db.prepare(`UPDATE schedule SET ${updates.join(', ')} WHERE id = 1`).run(...values);
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  res.json(schedule);
});

// POST /api/schedule/off-today — "I'm done for today"
router.post('/off-today', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE schedule SET off_today = 1 WHERE id = 1').run();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  res.json({ message: 'Agent unlocked for today', schedule });
});

// POST /api/schedule/off-until — "I'm off until [date]"
router.post('/off-until', (req, res) => {
  const db = getDb();
  const { until } = req.body;
  if (!until) return res.status(400).json({ error: 'until date is required' });

  db.prepare('UPDATE schedule SET vacation_mode = 1, vacation_until = ? WHERE id = 1').run(until);
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  res.json({ message: `Vacation mode until ${until}`, schedule });
});

// POST /api/schedule/im-back — "I'm back, pause agent"
router.post('/im-back', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE schedule SET vacation_mode = 0, vacation_until = NULL, off_today = 0 WHERE id = 1').run();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  res.json({ message: 'Welcome back! Agent paused.', schedule });
});

// POST /api/schedule/checkin
router.post('/checkin', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE schedule SET last_checkin = datetime('now') WHERE id = 1").run();
  res.json({ ok: true });
});

module.exports = router;
