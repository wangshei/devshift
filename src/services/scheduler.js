const cron = require('node-cron');
const { getDb } = require('../db');
const { executeTask } = require('./executor');
const { canAffordTask, getMaxTasksForWindow, getTasksExecutedThisWindow } = require('./planner');
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
  if (!activeDays.includes(localDay)) return true; // Weekend = off-hours for user = agent can work

  // Check active hours
  const [startH, startM] = (schedule.active_hours_start || '09:00').split(':').map(Number);
  const [endH, endM] = (schedule.active_hours_end || '18:00').split(':').map(Number);

  const currentMinutes = localHours * 60 + localMinutes;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Off-hours = outside active hours
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

  const task = pickNextTask();
  if (!task) {
    log.debug('Scheduler: no tasks available');
    return;
  }

  // Check credit budget
  if (!canAffordTask(task)) {
    log.info('Scheduler: insufficient credits for next task');
    return;
  }

  schedulerRunning = true;
  log.info(`Scheduler: executing "${task.title}"`);

  try {
    await executeTask(task.id);
  } catch (e) {
    log.error(`Scheduler execution error: ${e.message}`);
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
