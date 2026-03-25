const cron = require('node-cron');
const { getDb } = require('../db');
const { executeTask } = require('./executor');
const { canAffordTask, getMaxTasksForWindow, getTasksExecutedThisWindow, getCreditUsage } = require('./planner');
const log = require('../utils/logger');

let schedulerRunning = false;
let cronJob = null;

/**
 * Check if current time is within off-hours (agent can work).
 */
function isOffHours() {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();

  // Always-on mode: agent runs whenever there are tasks
  if (schedule.always_on) return true;

  // If user explicitly said "I'm done for today" or vacation mode
  if (schedule.off_today || schedule.vacation_mode) return true;

  const now = new Date();
  const tz = schedule.timezone || 'America/Los_Angeles';

  let localHours, localMinutes, localDay;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    localHours = parseInt(parts.find(p => p.type === 'hour').value, 10);
    localMinutes = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const dayName = parts.find(p => p.type === 'weekday').value;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    localDay = dayMap[dayName] ?? now.getDay();
  } catch {
    localHours = now.getHours();
    localMinutes = now.getMinutes();
    localDay = now.getDay();
  }

  // Check active days — new JSON format ({day, slot} array) is informational only
  const activeDaysRaw = schedule.active_days || '1,2,3,4,5';
  if (activeDaysRaw.trim().startsWith('[')) {
    // JSON grid format: always_on flag controls scheduling; default to working
    return true;
  }
  const activeDays = activeDaysRaw.split(',').map(Number);
  if (!activeDays.includes(localDay)) return true;

  // Check active hours
  const [startH, startM] = (schedule.active_hours_start || '09:00').split(':').map(Number);
  const [endH, endM] = (schedule.active_hours_end || '18:00').split(':').map(Number);

  const currentMinutes = localHours * 60 + localMinutes;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes < startMinutes || currentMinutes >= endMinutes;
}

/**
 * Pick the next task to execute based on priority ordering.
 */
function pickNextTask() {
  const db = getDb();
  return db.prepare(`
    SELECT t.* FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status IN ('backlog', 'queued') AND t.task_type = 'agent'
      AND p.paused = 0
      AND (
        (SELECT COUNT(*) FROM projects WHERE focus_mode = 1) = 0
        OR p.focus_mode = 1
      )
    ORDER BY
      p.priority ASC,
      CASE WHEN t.deadline IS NOT NULL THEN 0 ELSE 1 END,
      t.priority ASC,
      CASE t.tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      t.created_at ASC
    LIMIT 1
  `).get();
}

/**
 * Run Smart Mode analysis across all unpaused projects.
 * Skips projects analyzed in the last 6 hours and respects focus mode.
 * Analyzes one project per call to keep ticks short.
 */
async function runSmartModeForAllProjects() {
  const db = getDb();
  const projects = db.prepare("SELECT * FROM projects WHERE paused = 0").all();

  for (const project of projects) {
    // Skip if this project was analyzed recently (last 6 hours)
    const recentAnalysis = db.prepare(`
      SELECT COUNT(*) as c FROM tasks
      WHERE project_id = ? AND title LIKE 'Smart Mode:%' AND created_at > datetime('now', '-6 hours')
    `).get(project.id);

    if (recentAnalysis.c > 0) continue;

    // Skip projects with focus_mode off when another project has focus
    const focusedProject = db.prepare("SELECT id FROM projects WHERE focus_mode = 1").get();
    if (focusedProject && focusedProject.id !== project.id) continue;

    log.info(`[SmartMode] Analyzing project "${project.name}"...`);
    try {
      const smartMode = require('./smart-mode');
      const result = await smartMode.analyzeProject(project.id);
      if (result?.success) {
        log.info(`[SmartMode] Created ${result.tasksCreated} tasks for "${project.name}"`);
      }
    } catch (e) {
      log.warn(`[SmartMode] Failed for "${project.name}": ${e.message}`);
    }

    // Only analyze one project per tick
    break;
  }
}

/**
 * The main scheduler tick — runs every minute.
 *
 * Two modes:
 * - Work Mode: when there are backlog tasks → improve prompts, decompose, execute
 *   Processes up to 3 tasks per tick so the agent doesn't sit idle between tasks.
 * - Smart Mode: when backlog is empty + credits available → proactive improvements
 *   Cycles through ALL projects (not just one random one).
 */
async function tick() {
  if (schedulerRunning) {
    log.debug('Scheduler tick skipped — already running');
    return;
  }

  // Don't run anything until setup is complete
  const setupCheck = getDb().prepare('SELECT setup_complete FROM schedule WHERE id = 1').get();
  if (!setupCheck?.setup_complete) {
    log.debug('Scheduler tick — setup not complete, skipping');
    return;
  }

  if (!isOffHours()) {
    log.debug('Scheduler tick — active hours, agent paused');
    return;
  }

  // Check window task limit
  const executed = getTasksExecutedThisWindow();
  const maxTasks = getMaxTasksForWindow();
  if (executed >= maxTasks) {
    log.debug(`Scheduler: hit window limit (${executed}/${maxTasks})`);
    return;
  }

  schedulerRunning = true;

  try {
    // --- WORK MODE: process all available backlog tasks in a row ---
    let task = pickNextTask();
    let tasksExecutedThisTick = 0;

    while (task && tasksExecutedThisTick < 3) { // max 3 per tick to not hog
      const workMode = require('./work-mode');
      if (workMode.needsImprovement(task.title)) {
        try {
          const result = await workMode.improvePrompt(task.id);
          if (result.improved && result.subtaskCount > 0) {
            task = pickNextTask(); // pick the first subtask
            continue;
          }
        } catch (e) {
          log.warn(`[WorkMode] Improvement failed: ${e.message}`);
        }
      }

      if (!canAffordTask(task)) break;

      const freshTask = getDb().prepare("SELECT * FROM tasks WHERE id = ? AND status IN ('backlog', 'queued')").get(task.id);
      if (freshTask) {
        log.info(`Scheduler [WorkMode]: executing "${freshTask.title}"`);
        await executeTask(freshTask.id);
        tasksExecutedThisTick++;
      }

      // Check if we should continue
      if (getTasksExecutedThisWindow() >= maxTasks) break;
      task = pickNextTask();
    }

    // --- SMART MODE: if no backlog tasks and credits available, be proactive ---
    if (!task) {
      const credits = getCreditUsage();
      if (credits.availablePercent > 10) {
        await runSmartModeForAllProjects();
      }
    }
  } catch (e) {
    log.error(`Scheduler error: ${e.message}`);
  } finally {
    schedulerRunning = false;
  }
}

/**
 * Start the scheduler (runs tick every minute).
 */
function start() {
  if (cronJob) {
    log.warn('Scheduler already running');
    return;
  }

  cronJob = cron.schedule('* * * * *', () => {
    tick().catch(e => log.error('Scheduler tick error:', e.message));
  });

  log.info('Scheduler started — checking every minute');
}

/**
 * Stop the scheduler.
 */
function stop() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    log.info('Scheduler stopped');
  }
}

module.exports = { start, stop, isOffHours, tick, pickNextTask, runSmartModeForAllProjects };
