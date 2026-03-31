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

/**
 * Get per-provider average cost stats over the last 30 days.
 * @returns {Array<{ provider: string, avg_cost: number, runs: number }>}
 */
function getProviderCostStats() {
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT provider, AVG(actual_cost_usd) as avg_cost, COUNT(*) as runs
    FROM executions
    WHERE started_at > ? AND actual_cost_usd IS NOT NULL
    GROUP BY provider
  `).all(thirtyDaysAgo);
}

/**
 * Pick the cheapest eligible provider for a task based on historical cost data.
 * @param {{ tier?: number }} task
 * @param {Array<Object>} availableProviders - provider row objects from DB
 * @returns {Object|null} chosen provider or null
 */
function getPreferredProvider(task, availableProviders) {
  if (!availableProviders || availableProviders.length === 0) return null;

  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const tier = task.tier || 2;

  const costByProvider = new Map();
  for (const provider of availableProviders) {
    const stats = db.prepare(`
      SELECT provider, AVG(actual_cost_usd) as avg_cost, COUNT(*) as runs
      FROM executions
      WHERE started_at > ? AND provider = ? AND actual_cost_usd IS NOT NULL
      GROUP BY provider
    `).get(thirtyDaysAgo, provider.name);

    let avgCost;
    if (stats && stats.runs >= 3) {
      avgCost = stats.avg_cost;
    } else {
      const isSonnet = /sonnet/i.test(provider.model || provider.name || '');
      avgCost = isSonnet ? 0.06 : 0.10;
    }
    costByProvider.set(provider.name, avgCost);
  }

  const eligible = availableProviders
    .filter(p => {
      if (!p.use_for_tiers) return true;
      const tiers = String(p.use_for_tiers).split(',').map(Number);
      return tiers.includes(tier);
    })
    .sort((a, b) => costByProvider.get(a.name) - costByProvider.get(b.name));

  if (eligible.length === 0) return null;

  const chosen = eligible[0];
  const runnerUp = eligible.length > 1 ? eligible[1] : null;

  log.info(
    `Provider routing: chose ${chosen.name} (avg $${costByProvider.get(chosen.name).toFixed(4)})` +
    (runnerUp ? `, runner-up: ${runnerUp.name} (avg $${costByProvider.get(runnerUp.name).toFixed(4)})` : '') +
    ` for tier ${tier} task`
  );

  return chosen;
}

module.exports = {
  estimateTaskCostUsd, getCreditUsage, canAffordTask,
  getMaxTasksForWindow, getTasksExecutedThisWindow,
  getPreferredProvider, getProviderCostStats,
};
