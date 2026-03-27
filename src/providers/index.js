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
      `).run(p.id, p.name, installed ? 1 : 0, p.cli, installed ? 'detected' : 'not_installed');
      log.info(`Provider ${p.name}: ${installed ? 'detected' : 'not found'}`);
    }

    // Update auth status for detected providers (handles re-detection after install)
    if (installed) {
      db.prepare("UPDATE providers SET auth_status = 'detected' WHERE id = ? AND auth_status = 'not_installed'").run(p.id);
      db.prepare("UPDATE providers SET enabled = 1 WHERE id = ? AND auth_status = 'detected'").run(p.id);
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
 * @param {number} tier - task tier (1, 2, or 3)
 * @param {string|null} excludeId - optional provider ID to exclude (for fallback retries)
 */
function pickProvider(tier, excludeId = null) {
  const db = getDb();
  const now = new Date().toISOString();
  let query = `SELECT * FROM providers WHERE enabled = 1 AND (rate_limited_until IS NULL OR rate_limited_until < ?) ORDER BY priority ASC`;
  const providers = db.prepare(query).all(now);

  for (const p of providers) {
    if (excludeId && p.id === excludeId) continue;
    const tiers = (p.use_for_tiers || '1,2,3').split(',').map(Number);
    if (tiers.includes(tier)) return p;
  }

  // Fallback: any available provider (except excluded)
  return providers.find(p => !excludeId || p.id !== excludeId) || null;
}

module.exports = { detectProviders, getProviders, pickProvider, KNOWN_PROVIDERS };
