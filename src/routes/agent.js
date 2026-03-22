const { Router } = require('express');
const { getDb } = require('../db');
const { executeTask } = require('../services/executor');
const log = require('../utils/logger');

const router = Router();

// Agent state (in-memory for this process)
let agentState = {
  running: false,
  currentTaskId: null,
  paused: false,
};

// GET /api/agent/status
router.get('/status', (req, res) => {
  const db = getDb();
  const inProgress = db.prepare("SELECT * FROM tasks WHERE status = 'in_progress'").all();
  const queued = db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority ASC").all();

  res.json({
    ...agentState,
    currentTask: inProgress[0] || null,
    queuedTasks: queued.length,
  });
});

// POST /api/agent/start
router.post('/start', async (req, res) => {
  if (agentState.running) {
    return res.json({ message: 'Agent is already running' });
  }

  agentState.running = true;
  agentState.paused = false;
  res.json({ message: 'Agent started' });

  // Don't block the response — run tasks in background
  runNextTask().catch(e => log.error('Agent error:', e.message));
});

// POST /api/agent/pause
router.post('/pause', (req, res) => {
  agentState.paused = true;
  res.json({ message: 'Agent paused — will stop after current task completes' });
});

// POST /api/agent/resume
router.post('/resume', async (req, res) => {
  agentState.paused = false;
  res.json({ message: 'Agent resumed' });

  if (agentState.running) {
    runNextTask().catch(e => log.error('Agent error:', e.message));
  }
});

async function runNextTask() {
  if (agentState.paused || !agentState.running) return;

  const db = getDb();

  // Pick next task: priority ordering — Tier 1 first, Tier 3, then Tier 2
  const task = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('backlog', 'queued') AND task_type = 'agent'
    ORDER BY
      CASE WHEN deadline IS NOT NULL THEN 0 ELSE 1 END,
      priority ASC,
      CASE tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `).get();

  if (!task) {
    agentState.running = false;
    agentState.currentTaskId = null;
    log.info('No more tasks — agent idle');
    return;
  }

  agentState.currentTaskId = task.id;

  try {
    await executeTask(task.id);
  } catch (e) {
    log.error(`Error executing task ${task.id}:`, e.message);
  }

  agentState.currentTaskId = null;

  // Continue to next task
  if (!agentState.paused && agentState.running) {
    // Small delay between tasks
    setTimeout(() => runNextTask().catch(e => log.error('Agent error:', e.message)), 2000);
  }
}

module.exports = router;
