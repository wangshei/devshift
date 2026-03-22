const { execSync } = require('child_process');
const { getDb } = require('../db');
const log = require('../utils/logger');

const KNOWN_PROVIDERS = [
  { id: 'claude_code', name: 'Claude Code', cli: 'claude' },
  { id: 'antigravity', name: 'Google Antigravity', cli: 'agy' },
  { id: 'cursor', name: 'Cursor', cli: 'cursor' },
];

/**
 * Check if a CLI command exists on the system.
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

module.exports = { detectProviders, getProviders, pickProvider, KNOWN_PROVIDERS };
