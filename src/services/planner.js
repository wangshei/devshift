const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Estimate the USD cost of running a task based on tier and model.
 */
function estimateTaskCostUsd(task) {
  const isOpus = (task.model || '').includes('opus');
  const costs = isOpus
    ? { 1: 0.10, 2: 0.20, 3: 0.15 }
    : { 1: 0.03, 2: 0.06, 3: 0.04 };
  return costs[task.tier] || costs[2];
}

/**
 * Estimate the USD cost of running a task based on tier and model.
 */
function estimateCostUsd(task) {
  return estimateTaskCostUsd(task);
}

/**
 * @deprecated Use estimateCostUsd() instead.
 */
function estimateCreditCost(task) {
  return estimateCostUsd(task);
}

/**
 * Get real usage stats — no fake budgets.
 */
function getCreditUsage() {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date().toISOString().split('T')[0];

  // This week's costs
  const weekly = db.prepare(`
    SELECT COALESCE(SUM(actual_cost_usd), 0) as cost, COUNT(*) as count
    FROM executions WHERE started_at > ? AND status = 'completed'
  `).get(weekAgo);

  // Today's costs
  const today = db.prepare(`
    SELECT COALESCE(SUM(actual_cost_usd), 0) as cost, COUNT(*) as count
    FROM executions WHERE started_at > ? AND status = 'completed'
  `).get(todayStart);

  // Check rate limit status from providers
  const now = new Date().toISOString();
  const rateLimited = db.prepare(`
    SELECT id, name, rate_limited_until FROM providers
    WHERE enabled = 1 AND rate_limited_until IS NOT NULL AND rate_limited_until > ?
  `).all(now);

  const isRateLimited = rateLimited.length > 0;
  const resetsAt = rateLimited[0]?.rate_limited_until;

  return {
    weeklySpend: weekly.cost,
    weeklyTasks: weekly.count,
    todaySpend: today.cost,
    todayTasks: today.count,
    isRateLimited,
    resetsAt,
    rateLimitedProviders: rateLimited.map(p => p.name),
  };
}

/**
 * Check if we can run a task — based on rate limits, not fake budgets.
 */
function canAffordTask(task) {
  const db = getDb();
  const now = new Date().toISOString();

  // Check if any provider is available (not rate limited)
  const available = db.prepare(`
    SELECT COUNT(*) as c FROM providers
    WHERE enabled = 1 AND (rate_limited_until IS NULL OR rate_limited_until < ?)
  `).get(now);

  return available.c > 0;
}

/**
 * Budget status — based on rate limits, not dollar amounts.
 */
function getBudgetStatus() {
  const usage = getCreditUsage();
  if (usage.isRateLimited) {
    const resetsIn = usage.resetsAt ? Math.max(1, Math.round((new Date(usage.resetsAt) - Date.now()) / 60000)) : '?';
    return {
      status: 'rate_limited',
      message: `Rate limited — resets in ${resetsIn}min`,
      canRun: false,
    };
  }
  return { status: 'ok', message: 'Ready', canRun: true };
}

function getMaxTasksForWindow() {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  return schedule?.max_tasks_per_window || 30;
}

function getTasksExecutedThisWindow() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE started_at > ? AND status = 'completed'
  `).get(today);
  return result.count;
}

module.exports = {
  estimateTaskCostUsd, estimateCostUsd, estimateCreditCost, getCreditUsage,
  canAffordTask, getBudgetStatus, getMaxTasksForWindow, getTasksExecutedThisWindow,
};
