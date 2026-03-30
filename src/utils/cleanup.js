const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const log = require('./logger');
const { pruneMemories } = require('../services/memory');

/**
 * Clean up old execution log files and completed execution records.
 * Keeps logs for the last 7 days, deletes older ones.
 */
function cleanupOldLogs() {
  const config = require('./config');
  const dataDir = config.DATA_DIR || 'data';

  if (!fs.existsSync(dataDir)) return;

  let retentionDays = 7;
  try {
    const { getDb } = require('../db');
    const schedule = getDb().prepare('SELECT log_retention_days FROM schedule WHERE id = 1').get();
    retentionDays = schedule?.log_retention_days || 7;
  } catch {}
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  try {
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('exec-') && f.endsWith('.log'));

    for (const file of files) {
      const filePath = path.join(dataDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch { /* skip files we can't read */ }
    }

    if (deleted > 0) {
      log.info(`[Cleanup] Deleted ${deleted} old execution log files`);
    }
  } catch (e) {
    log.warn(`[Cleanup] Failed: ${e.message}`);
  }

  // Prune old memories
  try {
    pruneMemories();
  } catch (e) {
    log.warn(`[Cleanup] Memory pruning failed: ${e.message}`);
  }

  // Compact database after cleanup
  try {
    const { getDb } = require('../db');
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
}

module.exports = { cleanupOldLogs };
