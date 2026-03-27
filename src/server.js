const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./utils/config');
const log = require('./utils/logger');
const { migrate } = require('./db');
const scheduler = require('./services/scheduler');
// planner still used by scheduler for canAffordTask
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

// Credit usage endpoint — reads actual CLI usage from Claude's history
app.get('/api/credits', (req, res) => {
  const { getDb } = require('./db');
  const os = require('os');
  const fs = require('fs');
  const readline = require('readline');
  const db = getDb();

  const agentTasksDone = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND task_type = 'agent'").get().count;
  const providers = db.prepare("SELECT * FROM providers WHERE enabled = 1").all();

  // Read actual Claude CLI usage from ~/.claude/history.jsonl
  const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const todayStart = new Date().setHours(0, 0, 0, 0);

  let weekSessions = new Set();
  let weekMessages = 0;
  let todaySessions = new Set();
  let todayMessages = 0;

  try {
    if (fs.existsSync(historyPath)) {
      const lines = fs.readFileSync(historyPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp || 0;
          if (ts > weekAgo) {
            weekSessions.add(entry.sessionId);
            weekMessages++;
          }
          if (ts > todayStart) {
            todaySessions.add(entry.sessionId);
            todayMessages++;
          }
        } catch { /* skip bad lines */ }
      }
    }
  } catch { /* history file unreadable */ }

  // Provider breakdown with real CLI usage data
  const providerBreakdown = providers.map(prov => {
    const weekAgoISO = new Date(weekAgo).toISOString();
    const execs = db.prepare("SELECT COUNT(*) as count FROM executions WHERE provider = ? AND started_at > ? AND status = 'completed'").get(prov.id, weekAgoISO);
    return {
      id: prov.id,
      name: prov.name,
      agentTasks: execs.count,
      authStatus: prov.auth_status,
      rateLimitedUntil: prov.rate_limited_until,
    };
  });

  // Agent vs human collaboration
  const weekAgoISO = new Date(weekAgo).toISOString();
  const agentTasksWeek = db.prepare("SELECT COUNT(*) as count FROM executions WHERE started_at > ? AND status = 'completed'").get(weekAgoISO).count;

  // Approximate: each CLI session ≈ 1 human task
  const humanTasksWeek = weekSessions.size;

  res.json({
    agentTasksDone,
    providerBreakdown,
    // Actual CLI usage (from Claude's history)
    cliUsage: {
      weekSessions: weekSessions.size,
      weekMessages,
      todaySessions: todaySessions.size,
      todayMessages,
    },
    collaboration: {
      agentTasks: agentTasksWeek,
      humanSessions: humanTasksWeek,
      agentPercent: (agentTasksWeek + humanTasksWeek) > 0 ? Math.round((agentTasksWeek / (agentTasksWeek + humanTasksWeek)) * 100) : 0,
      humanPercent: (agentTasksWeek + humanTasksWeek) > 0 ? Math.round((humanTasksWeek / (agentTasksWeek + humanTasksWeek)) * 100) : 0,
    },
  });
});

// GET /api/plan-status — check remaining capacity from CLI tools + estimate usage
app.get('/api/plan-status', async (req, res) => {
  const { execSync } = require('child_process');
  const { getDb } = require('./db');
  const db = getDb();
  const result = { providers: [] };

  // Typical weekly task capacity per plan (rough estimates)
  const planCapacity = {
    'Pro ($20/mo)': { tasksPerWeek: 30, price: '$20/mo' },
    'Max 5x ($100/mo)': { tasksPerWeek: 150, price: '$100/mo' },
    'Max 20x ($200/mo)': { tasksPerWeek: 600, price: '$200/mo' },
    'Free (preview)': { tasksPerWeek: 20, price: 'Free' },
    'Pro ($20/mo) ': { tasksPerWeek: 60, price: '$20/mo' }, // Cursor
  };

  // Count tasks per provider this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  function getProviderTasksThisWeek(providerId) {
    return db.prepare("SELECT COUNT(*) as count FROM executions WHERE provider = ? AND started_at > ? AND status = 'completed'")
      .get(providerId, weekAgo).count;
  }

  // Also count CLI messages for Claude (from history)
  let cliMessagesThisWeek = 0;
  try {
    const os = require('os');
    const historyPath = require('path').join(os.homedir(), '.claude', 'history.jsonl');
    const fs = require('fs');
    if (fs.existsSync(historyPath)) {
      const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const lines = fs.readFileSync(historyPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if ((entry.timestamp || 0) > weekAgoMs) cliMessagesThisWeek++;
        } catch {}
      }
    }
  } catch {}

  // Claude Code
  let claudePlan = 'Pro ($20/mo)';
  try {
    const output = execSync('claude /cost 2>&1', { encoding: 'utf-8', timeout: 10000 });
    if (output.includes('max') || output.includes('Max')) {
      if (output.toLowerCase().includes('20x')) claudePlan = 'Max 20x ($200/mo)';
      else claudePlan = 'Max 5x ($100/mo)';
    }
  } catch {}

  const claudeAgentTasks = getProviderTasksThisWeek('claude_code');
  const cap = planCapacity[claudePlan] || planCapacity['Pro ($20/mo)'];
  // Estimate: each CLI message ≈ 0.3 task units, each agent task ≈ 1 unit
  const claudeEstUsed = Math.round(((cliMessagesThisWeek * 0.3) + claudeAgentTasks) / cap.tasksPerWeek * 100);
  const claudeRemaining = Math.max(0, 100 - claudeEstUsed);

  result.providers.push({
    id: 'claude_code',
    name: 'Claude',
    plan: claudePlan,
    status: claudeRemaining < 5 ? 'rate_limited' : 'available',
    usedPercent: Math.min(100, claudeEstUsed),
    remainingPercent: claudeRemaining,
    detail: `~${claudeAgentTasks} agent tasks + ~${cliMessagesThisWeek} CLI messages this week`,
    refresh: 'Weekly rolling',
    estimated: true,
  });

  // Cursor
  {
    const fs = require('fs');
    let cursorFound = false;
    try { execSync('which cursor', { stdio: 'ignore', timeout: 5000 }); cursorFound = true; } catch {}
    if (!cursorFound) {
      cursorFound = fs.existsSync('/Applications/Cursor.app') ||
        fs.existsSync(require('path').join(process.env.HOME || '', 'Applications/Cursor.app'));
    }
    if (cursorFound) {
      const cursorTasks = getProviderTasksThisWeek('cursor');
      const cursorUsed = Math.round((cursorTasks / 60) * 100); // ~60 tasks per $20 plan
      result.providers.push({
        id: 'cursor', name: 'Cursor', plan: 'Pro ($20/mo)',
        status: 'available',
        usedPercent: Math.min(100, cursorUsed),
        remainingPercent: Math.max(0, 100 - cursorUsed),
        detail: `~${cursorTasks} agent tasks this month`,
        refresh: 'Monthly',
        estimated: true,
      });
    } else {
      result.providers.push({ id: 'cursor', name: 'Cursor', status: 'not_installed' });
    }
  }

  // Antigravity
  try {
    execSync('which agy', { stdio: 'ignore', timeout: 5000 });
    const agyTasks = getProviderTasksThisWeek('antigravity');
    const agyUsed = Math.round((agyTasks / 20) * 100); // ~20 tasks per free tier week
    result.providers.push({
      id: 'antigravity', name: 'Antigravity', plan: 'Free (preview)',
      status: 'available',
      usedPercent: Math.min(100, agyUsed),
      remainingPercent: Math.max(0, 100 - agyUsed),
      detail: `~${agyTasks} agent tasks this week`,
      refresh: 'Weekly (free) / 5h (Pro)',
      estimated: true,
    });
  } catch {
    result.providers.push({ id: 'antigravity', name: 'Antigravity', status: 'not_installed' });
  }

  res.json(result);
});

// POST /api/tasks/:id/watch — open Terminal.app to watch task execution
app.post('/api/tasks/:id/watch', (req, res) => {
  const { getDb } = require('./db');
  const { execSync } = require('child_process');
  const db = getDb();

  // Find the execution log path
  const exec = db.prepare(`
    SELECT e.log_path FROM executions e
    WHERE e.task_id = ? ORDER BY e.started_at DESC LIMIT 1
  `).get(req.params.id);

  if (!exec?.log_path) {
    return res.status(404).json({ error: 'No execution log found for this task' });
  }

  const fs = require('fs');
  // Create the log file if it doesn't exist yet
  if (!fs.existsSync(exec.log_path)) {
    fs.writeFileSync(exec.log_path, '', 'utf-8');
  }

  try {
    // Open Terminal.app with tail -f on the log file
    execSync(`osascript -e 'tell application "Terminal"
      activate
      do script "echo \\"DevShift — watching task execution\\" && echo \\"Log: ${exec.log_path}\\" && echo \\"---\\" && tail -f \\"${exec.log_path}\\""
    end tell'`, { timeout: 5000 });
    res.json({ opened: true, logPath: exec.log_path });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/open-file — open a file in the default editor or Finder
app.post('/api/open-file', (req, res) => {
  const { execSync } = require('child_process');
  const { file_path, app: appName } = req.body;
  if (!file_path) return res.status(400).json({ error: 'file_path required' });

  const fs = require('fs');
  if (!fs.existsSync(file_path)) return res.status(404).json({ error: 'File not found' });

  try {
    if (appName) {
      execSync(`open -a "${appName}" "${file_path}"`, { timeout: 5000 });
    } else {
      execSync(`open "${file_path}"`, { timeout: 5000 });
    }
    res.json({ opened: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/open-url — open a URL in the default browser
app.post('/api/open-url', (req, res) => {
  const { execSync } = require('child_process');
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    execSync(`open "${url}"`, { timeout: 5000 });
    res.json({ opened: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
