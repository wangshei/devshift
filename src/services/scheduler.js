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

  // Check active days
  const activeDays = (schedule.active_days || '1,2,3,4,5').split(',').map(Number);
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
    SELECT * FROM tasks
    WHERE status IN ('backlog', 'queued') AND task_type = 'agent'
    ORDER BY
      CASE WHEN deadline IS NOT NULL THEN 0 ELSE 1 END,
      priority ASC,
      CASE tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 1
  `).get();
}

/**
 * The main scheduler tick — runs every minute.
 *
 * Two modes:
 * - Work Mode: when there are backlog tasks → improve prompts, decompose, execute
 * - Smart Mode: when backlog is empty + credits available → proactive improvements
 */
async function tick() {
  if (schedulerRunning) {
    log.debug('Scheduler tick skipped — already running');
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
    // --- WORK MODE: process backlog tasks ---
    const task = pickNextTask();

    if (task) {
      // Check if this task needs prompt improvement first
      const workMode = require('./work-mode');
      if (workMode.needsImprovement(task.title)) {
        log.info(`[WorkMode] Improving vague task: "${task.title}"`);
        try {
          const result = await workMode.improvePrompt(task.id);
          if (result.improved && result.subtaskCount > 0) {
            // Task was decomposed — subtasks are now in backlog, will be picked up next tick
            log.info(`[WorkMode] Decomposed into ${result.subtaskCount} subtasks`);
            return;
          }
          // If improved but not decomposed, the task title/description is now better
          // Re-fetch it and continue to execution
        } catch (e) {
          log.warn(`[WorkMode] Improvement failed, executing as-is: ${e.message}`);
        }
      }

      // Check credit budget
      if (!canAffordTask(task)) {
        log.info('Scheduler: insufficient credits for next task');
        return;
      }

      // Re-fetch task (may have been improved)
      const freshTask = getDb().prepare('SELECT * FROM tasks WHERE id = ? AND status IN (\'backlog\', \'queued\')').get(task.id);
      if (freshTask) {
        log.info(`Scheduler [WorkMode]: executing "${freshTask.title}"`);
        await executeTask(freshTask.id);
      }
      return;
    }

    // --- SMART MODE: no backlog tasks, use remaining credits proactively ---
    const credits = getCreditUsage();
    if (credits.availablePercent > 10) {
      // There are credits to burn and no user tasks — be proactive
      log.info('[SmartMode] No backlog tasks, running proactive analysis...');
      try {
        const smartMode = require('./smart-mode');
        const result = await smartMode.run();
        if (result && result.success) {
          log.info(`[SmartMode] Created ${result.tasksCreated} improvement tasks (${result.analysis})`);
          // Next tick will pick up the generated tasks in Work Mode
        }
      } catch (e) {
        log.warn(`[SmartMode] Failed: ${e.message}`);
      }
    } else {
      log.debug('Scheduler: no tasks and credits low — idle');
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

module.exports = { start, stop, isOffHours, tick, pickNextTask };
