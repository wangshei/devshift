const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./utils/config');
const log = require('./utils/logger');
const { migrate } = require('./db');
const scheduler = require('./services/scheduler');
const { getCreditUsage, getBudgetStatus } = require('./services/planner');
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
app.use('/api/comments', require('./routes/comments'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/product', require('./routes/product'));

// Memory stats endpoint
app.get('/api/memory/stats', (req, res) => {
  const db = require('./db').getDb();
  const projectCount = db.prepare('SELECT COUNT(*) as c FROM project_memory').get().c;
  const systemCount = db.prepare('SELECT COUNT(*) as c FROM system_memory').get().c;
  const schedule = db.prepare('SELECT memory_per_category, memory_system_max, log_retention_days FROM schedule WHERE id = 1').get();
  res.json({
    projectMemories: projectCount,
    systemMemories: systemCount,
    limits: {
      perCategory: schedule?.memory_per_category || 20,
      systemMax: schedule?.memory_system_max || 30,
      logRetentionDays: schedule?.log_retention_days || 7,
    }
  });
});

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
  res.json({ ...getCreditUsage(), ...getBudgetStatus(), agentTasksDone, humanTasksDone, providerBreakdown });
});

// My Work endpoint — cross-project view for the human
app.get('/api/my-work', (req, res) => {
  const db = require('./db').getDb();

  // Active human work
  const activeWork = db.prepare(`
    SELECT t.*, p.name as project_name, p.repo_path
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'in_progress' AND t.worker LIKE 'human%'
    ORDER BY t.started_at DESC
  `).all();

  // Plan reviews
  const planReviews = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.plan_status = 'pending_review' AND t.status = 'needs_review'
    ORDER BY t.created_at DESC
  `).all();

  // Code reviews (needs_review, not analysis, not plan)
  const codeReviews = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'needs_review' AND t.tier != 3
      AND (t.plan_status IS NULL OR t.plan_status != 'pending_review')
      AND t.branch_name IS NOT NULL
    ORDER BY t.completed_at DESC
  `).all();

  // Analysis results
  const analyses = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'needs_review' AND t.tier = 3
    ORDER BY t.completed_at DESC
  `).all();

  // Human tasks awaiting action
  const humanTasks = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.task_type = 'human' AND t.status IN ('backlog', 'queued')
    ORDER BY t.priority ASC, t.created_at ASC
  `).all();

  // Failed tasks
  const failed = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'failed'
    ORDER BY t.completed_at DESC LIMIT 20
  `).all();

  // Recently completed (last 24h)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentlyCompleted = db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done' AND t.completed_at > ?
    ORDER BY t.completed_at DESC
  `).all(yesterday);

  res.json({
    activeWork,
    planReviews,
    codeReviews,
    analyses,
    humanTasks,
    failed,
    recentlyCompleted,
    counts: {
      needsAttention: planReviews.length + codeReviews.length + analyses.length + humanTasks.length + failed.length,
      activeWork: activeWork.length,
      recentlyCompleted: recentlyCompleted.length,
    }
  });
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

// Seed agents for existing projects
try {
  const { seedAgentsForProject } = require('./services/agents');
  const db = require('./db').getDb();
  const projects = db.prepare('SELECT id FROM projects').all();
  for (const p of projects) seedAgentsForProject(p.id);
} catch {}

// Auto-detect providers on startup
const { detectProviders } = require('./providers');
detectProviders();

const { cleanupOldLogs } = require('./utils/cleanup');
const cron = require('node-cron');

app.listen(PORT, () => {
  log.info(`DevShift server running on http://localhost:${PORT}`);
  // Start the scheduler
  scheduler.start();
  // Start Telegram bot (if configured)
  telegram.start();
  // Run cleanup on startup
  cleanupOldLogs();
  // Run cleanup daily at 3am
  cron.schedule('0 3 * * *', () => cleanupOldLogs());
});

module.exports = app;
