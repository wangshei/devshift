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

// Credit usage endpoint
app.get('/api/credits', (req, res) => {
  res.json(getCreditUsage());
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

app.listen(PORT, () => {
  log.info(`DevShift server running on http://localhost:${PORT}`);
  // Start the scheduler
  scheduler.start();
  // Start Telegram bot (if configured)
  telegram.start();
});

module.exports = app;
