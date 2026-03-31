const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Estimate the USD cost of running a task based on tier and model.
 * Sonnet: ~$0.03-0.06 per task. Opus: ~$0.10-0.20.
 * @param {{ tier?: number, model?: string }} task
 * @returns {number} Estimated cost in USD
 */
function estimateTaskCostUsd(task) {
  const isOpus = (task.model || '').includes('opus');
  const costs = isOpus
    ? { 1: 0.10, 2: 0.20, 3: 0.15 }
    : { 1: 0.03, 2: 0.06, 3: 0.04 };
  return costs[task.tier] || costs[2];
}

/**
 * Get credit/cost usage stats for the current week.
 */
function getCreditUsage() {
  const db = getDb();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Real USD costs from execution records
  const costs = db.prepare(`
    SELECT COALESCE(SUM(actual_cost_usd), 0) as total_usd,
           COUNT(*) as count
    FROM executions WHERE started_at > ? AND status = 'completed'
  `).get(weekAgo);

  // Budget from schedule
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  const reservePercent = schedule?.reserve_percent || 40;

  // Estimate weekly budget based on plan ($5 default, overridable)
  const weeklyBudgetUsd = 5.00;
  const reserved = weeklyBudgetUsd * (reservePercent / 100);
  const available = Math.max(0, weeklyBudgetUsd - costs.total_usd - reserved);

  return {
    budget: weeklyBudgetUsd,
    realCostUsd: costs.total_usd,
    executionCount: costs.count,
    reserved,
    available,
    usedPercent: Math.round((costs.total_usd / weeklyBudgetUsd) * 100),
    reservedPercent: reservePercent,
    availablePercent: Math.round((available / weeklyBudgetUsd) * 100),
  };
}

/**
 * Check if we can afford to run a task based on real USD spend.
 */
function canAffordTask(task) {
  const cost = estimateTaskCostUsd(task);
  const usage = getCreditUsage();
  return usage.available >= cost;
}

/**
 * Get the max tasks for the current window based on schedule config.
 */
function getMaxTasksForWindow() {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  return schedule?.max_tasks_per_window || 6;
}

/**
 * Count tasks executed in the current off-hours window.
 */
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
  estimateTaskCostUsd, getCreditUsage, canAffordTask,
  getMaxTasksForWindow, getTasksExecutedThisWindow,
};
