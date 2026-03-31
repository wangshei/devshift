const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Estimate credit cost for a task based on tier and model.
 * Returns a rough percentage of weekly credits.
 */
function estimateCreditCost(task) {
  const baseCosts = { 1: 1, 2: 3, 3: 2 };
  const modelMultiplier = task.model === 'opus' ? 2.5 : 1;
  return (baseCosts[task.tier] || 2) * modelMultiplier;
}

/**
 * Get approximate credit usage stats.
 */
function getCreditUsage() {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();

  // Count executions this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const executions = db.prepare(`
    SELECT COUNT(*) as count, SUM(estimated_credits) as total_credits
    FROM executions WHERE started_at > ?
  `).get(weekAgo);

  // Estimate total budget based on plan
  const planBudgets = {
    'pro': 30,          // ~30 "credit units" per week
    'max 5x': 100,
    'max_5x': 100,
    'max 20x': 200,
    'max_20x': 200,
    'free': 50,         // Antigravity free tier
    'unknown': 60,
  };

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(schedule.primary_provider);
  const tier = provider ? (provider.plan_tier || 'unknown') : 'unknown';
  const budget = planBudgets[tier] || 60;

  const agentUsed = executions.total_credits || 0;
  const reservePercent = schedule.reserve_percent || 40;
  const reserved = budget * (reservePercent / 100);
  const available = Math.max(0, budget - agentUsed - reserved);

  // Get real USD costs from provider responses
  const realCosts = db.prepare(`
    SELECT COALESCE(SUM(actual_cost_usd), 0) as total_usd,
           COUNT(*) as count
    FROM executions WHERE started_at > ? AND actual_cost_usd IS NOT NULL
  `).get(weekAgo);

  return {
    budget,
    agentUsed,
    reserved,
    available,
    usedPercent: Math.round((agentUsed / budget) * 100),
    reservedPercent: reservePercent,
    availablePercent: Math.round((available / budget) * 100),
    realCostUsd: realCosts.total_usd,
    executionCount: realCosts.count,
  };
}

/**
 * Estimate USD cost for a task based on tier and model.
 * @param {{ tier: number, model?: string }} task
 * @returns {number} estimated cost in USD
 */
function estimateUsdCost(task) {
  const baseCosts = { 1: 0.15, 2: 0.45, 3: 0.30 };
  const modelMultiplier = task.model === 'opus' ? 2.5 : 1;
  return (baseCosts[task.tier] || 0.30) * modelMultiplier;
}

/**
 * Check if we can afford to run a task based on USD budget.
 * Reads usd_budget from the schedule row; falls back to $5.00 when absent or NULL.
 * @param {{ tier: number, model?: string }} task
 * @returns {boolean}
 */
function canAffordTask(task) {
  const cost = estimateUsdCost(task);
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  const usdBudget = (schedule && schedule.usd_budget != null) ? schedule.usd_budget : 5.00;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { spent } = db.prepare(
    'SELECT COALESCE(SUM(actual_cost_usd), 0) as spent FROM executions WHERE started_at > ?'
  ).get(weekAgo);
  return (usdBudget - spent) >= cost;
}

/**
 * Get the max tasks for the current window based on schedule config.
 */
function getMaxTasksForWindow() {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  return schedule.max_tasks_per_window || 6;
}

/**
 * Count tasks executed in the current off-hours window.
 */
function getTasksExecutedThisWindow() {
  const db = getDb();
  // Count tasks completed today
  const today = new Date().toISOString().split('T')[0];
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE started_at > ? AND status = 'completed'
  `).get(today);
  return result.count;
}

module.exports = {
  estimateCreditCost, estimateUsdCost, getCreditUsage, canAffordTask,
  getMaxTasksForWindow, getTasksExecutedThisWindow,
};
