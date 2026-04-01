const { execSync } = require('child_process');
const { getDb } = require('../db');
const log = require('../utils/logger');

const KNOWN_PROVIDERS = [
  { id: 'claude_code', name: 'Claude Code', cli: 'claude' },
  { id: 'antigravity', name: 'Google Antigravity', cli: 'agy' },
  { id: 'cursor', name: 'Cursor', cli: 'cursor' },
];

const fs = require('fs');
const path = require('path');

/**
 * Check if a CLI command exists on the system.
 * Also checks common app locations for macOS apps.
 */
function commandExists(cmd) {
  // Check PATH first
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch { /* not on PATH */ }

  // Check common macOS app locations
  const appChecks = {
    cursor: [
      '/Applications/Cursor.app',
      path.join(process.env.HOME || '', 'Applications/Cursor.app'),
    ],
    agy: [
      '/Applications/Antigravity.app',
      path.join(process.env.HOME || '', '.antigravity'),
    ],
  };

  const paths = appChecks[cmd];
  if (paths) {
    for (const p of paths) {
      if (fs.existsSync(p)) return true;
    }
  }

  return false;
}

/**
 * Auto-detect installed providers and seed the providers table.
 */
function detectProviders() {
  const db = getDb();
  const results = [];

  for (const p of KNOWN_PROVIDERS) {
    const installed = commandExists(p.cli);
    const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(p.id);

    if (!existing) {
      db.prepare(`
        INSERT INTO providers (id, name, enabled, cli_command, auth_status)
        VALUES (?, ?, ?, ?, ?)
      `).run(p.id, p.name, installed ? 1 : 0, p.cli, installed ? 'unknown' : 'not_installed');
      log.info(`Provider ${p.name}: ${installed ? 'detected' : 'not found'}`);
    }

    results.push({
      id: p.id,
      name: p.name,
      installed,
      enabled: existing ? !!existing.enabled : installed,
    });
  }

  return results;
}

/**
 * Get all providers from DB.
 */
function getProviders() {
  const db = getDb();
  return db.prepare('SELECT * FROM providers ORDER BY priority ASC').all();
}

/**
 * Pick the best provider for a given task tier.
 * Respects rate limits, enabled status, and tier routing.
 */
function pickProvider(tier) {
  const db = getDb();
  const now = new Date().toISOString();
  const providers = db.prepare(`
    SELECT * FROM providers
    WHERE enabled = 1
      AND (rate_limited_until IS NULL OR rate_limited_until < ?)
    ORDER BY priority ASC
  `).all(now);

  // Find a provider that handles this tier
  for (const p of providers) {
    const tiers = (p.use_for_tiers || '1,2,3').split(',').map(Number);
    if (tiers.includes(tier)) {
      return p;
    }
  }

  // Fallback: any available provider
  return providers[0] || null;
}

/**
 * Pick the best provider for a task based on:
 * 1. Task complexity (tier 1 easy tasks → cheaper providers first)
 * 2. Unused credits (least-used provider this week goes first)
 * 3. Provider capabilities (opus only on claude_code)
 * 4. Rate limit status
 *
 * Strategy:
 * - Tier 1 (quick wins): prefer Antigravity/Cursor (save Claude credits for harder work)
 * - Tier 2 (features): prefer least-used provider, Claude for opus
 * - Tier 3 (research): any available provider
 *
 * @param {object} task - { tier, model, title, provider }
 * @returns {object|null} provider record from DB
 */
function pickBestProvider(task) {
  const db = getDb();
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // If task explicitly requests a provider, try that first
  if (task.provider) {
    const explicit = db.prepare(`
      SELECT * FROM providers WHERE id = ? AND enabled = 1
        AND (rate_limited_until IS NULL OR rate_limited_until < ?)
    `).get(task.provider, now);
    if (explicit) return explicit;
  }

  const providers = db.prepare(`
    SELECT * FROM providers
    WHERE enabled = 1
      AND (rate_limited_until IS NULL OR rate_limited_until < ?)
    ORDER BY priority ASC
  `).all(now);

  if (!providers.length) return null;

  // Calculate usage per provider this week
  for (const p of providers) {
    const usage = db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(actual_cost_usd), 0) as cost FROM executions WHERE provider = ? AND started_at > ?'
    ).get(p.id, weekAgo);
    p._weeklyUsage = usage.count;
    p._weeklyCost = usage.cost;
  }

  const tier = task.tier || 2;

  // Filter to providers that handle this tier
  const eligible = providers.filter(p => {
    const tiers = (p.use_for_tiers || '1,2,3').split(',').map(Number);
    return tiers.includes(tier);
  });

  if (!eligible.length) return providers[0] || null;

  // For headless (autonomous) execution, only claude_code works — others need a GUI window
  // Antigravity's `agy chat` opens a window, Cursor has no CLI
  const headlessProviders = eligible.filter(p => p.id === 'claude_code');
  if (headlessProviders.length > 0 && !task._interactive) {
    return headlessProviders[0];
  }

  // Tier 2 with opus: must use Claude (other providers don't support opus)
  if (task.model === 'opus') {
    const claude = eligible.find(p => p.id === 'claude_code');
    if (claude) return claude;
  }

  // Default: least-used provider first (spread credits evenly)
  eligible.sort((a, b) => a._weeklyUsage - b._weeklyUsage);

  // If Claude is rate-limited or heavily used, prefer alternatives
  const claude = eligible.find(p => p.id === 'claude_code');
  const others = eligible.filter(p => p.id !== 'claude_code');
  if (claude && others.length > 0 && claude._weeklyUsage > others[0]._weeklyUsage * 2) {
    // Claude has 2x more usage than the least-used alternative — use the alternative
    return others[0];
  }

  return eligible[0];
}

module.exports = { detectProviders, getProviders, pickProvider, pickBestProvider, KNOWN_PROVIDERS };
