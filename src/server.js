const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./utils/config');
const log = require('./utils/logger');
const { migrate } = require('./db');

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

// Run migrations on startup
migrate();

app.listen(PORT, () => {
  log.info(`DevShift server running on http://localhost:${PORT}`);
});

module.exports = app;
