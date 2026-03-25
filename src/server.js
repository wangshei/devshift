const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./utils/config');
const log = require('./utils/logger');
const { migrate } = require('./db');
const scheduler = require('./services/scheduler');
const { getCreditUsage } = require('./services/planner');
const telegram = require('./services/telegram');

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// Routes
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/providers', require('./routes/providers'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/timeline', require('./routes/timeline'));
app.use('/api/changelog', require('./routes/changelog'));
app.use('/api/setup', require('./routes/setup'));

// Credit usage endpoint
app.get('/api/credits', (req, res) => {
  const { getDb } = require('./db');
  const db = getDb();
  const agentTasksDone = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND task_type = 'agent'").get().count;
  const humanTasksDone = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND task_type != 'agent'").get().count;
  const providers = db.prepare("SELECT * FROM providers WHERE enabled = 1").all();
  const providerBreakdown = providers.map(prov => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const execs = db.prepare("SELECT COUNT(*) as count FROM executions WHERE provider = ? AND started_at > ? AND status = 'completed'").get(prov.id, weekAgo);
    return {
      id: prov.id,
      name: prov.name,
      tasksDone: execs.count,
      authStatus: prov.auth_status,
      rateLimitedUntil: prov.rate_limited_until,
    };
  });
  res.json({ ...getCreditUsage(), agentTasksDone, humanTasksDone, providerBreakdown });
});

// Serve dashboard in production
const dashboardDist = path.join(__dirname, '..', 'dashboard', 'dist');
app.use(express.static(dashboardDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dashboardDist, 'index.html'));
});

// Run migrations on startup
migrate();

// Auto-detect providers on startup
const { detectProviders } = require('./providers');
detectProviders();

app.listen(PORT, () => {
  log.info(`DevShift server running on http://localhost:${PORT}`);
  // Start the scheduler
  scheduler.start();
  // Start Telegram bot (if configured)
  telegram.start();
});

module.exports = app;
