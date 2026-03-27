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
  mode: 'idle', // 'idle', 'work', 'smart'
};

// GET /api/agent/status
router.get('/status', (req, res) => {
  const db = getDb();
  const inProgress = db.prepare("SELECT * FROM tasks WHERE status = 'in_progress'").all();
  const queued = db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY priority ASC").all();

  const backlog = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('backlog', 'queued') AND task_type = 'agent'").get();

  res.json({
    ...agentState,
    currentTask: inProgress[0] || null,
    queuedTasks: queued.length,
    backlogTasks: backlog.count,
    mode: backlog.count > 0 ? 'work' : (agentState.running ? 'smart' : 'idle'),
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

// POST /api/agent/smart-mode — manually trigger smart mode on a project
router.post('/smart-mode', async (req, res) => {
  const { project_id, analysis_type } = req.body;
  try {
    const smartMode = require('../services/smart-mode');
    if (project_id) {
      const result = await smartMode.analyzeProject(project_id, analysis_type || undefined);
      return res.json(result);
    }
    const result = await smartMode.run();
    res.json(result || { success: false, error: 'No projects available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agent/improve-task — manually trigger work mode on a task
router.post('/improve-task', async (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ error: 'task_id required' });
  try {
    const workMode = require('../services/work-mode');
    const result = await workMode.improvePrompt(task_id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agent/smart-mode/types — available analysis types
router.get('/smart-mode/types', (req, res) => {
  const smartMode = require('../services/smart-mode');
  res.json(Object.keys(smartMode.ANALYSIS_PROMPTS).map(key => ({
    id: key,
    name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  })));
});

// GET /api/agent/missions — list available missions
router.get('/missions', (req, res) => {
  const { MISSIONS } = require('../services/missions');
  const list = Object.entries(MISSIONS).map(([id, m]) => ({
    id,
    name: m.name,
    description: m.description,
    icon: m.icon,
  }));
  res.json(list);
});

// POST /api/agent/missions/run — run a mission on a project
router.post('/missions/run', async (req, res) => {
  const { project_id, mission_type } = req.body;
  if (!project_id || !mission_type) {
    return res.status(400).json({ error: 'project_id and mission_type required' });
  }

  try {
    const { runMission } = require('../services/missions');
    const result = await runMission(project_id, mission_type);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agent/scan-project — analyze project and create tasks
router.post('/scan-project', async (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const smartMode = require('../services/smart-mode');
    // Run all analysis types
    const types = ['code_quality', 'test_coverage', 'security', 'documentation'];
    let totalTasks = 0;
    for (const type of types) {
      try {
        const result = await smartMode.analyzeProject(project_id, type);
        if (result?.tasksCreated) totalTasks += result.tasksCreated;
      } catch (e) {
        log.warn(`[ScanProject] ${type} analysis failed: ${e.message}`);
      }
    }

    res.json({ success: true, tasksCreated: totalTasks, message: `Found ${totalTasks} tasks for ${project.name}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
