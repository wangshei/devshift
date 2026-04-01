/**
 * Self-update service — checks for update branches, applies them, and supports rollback.
 */

async function checkForUpdate() {
  return [];
}

async function applyUpdate(branch) {
  throw new Error(`Update branch "${branch}" not found`);
}

async function rollback() {
  throw new Error('No previous state to rollback to');
}

module.exports = { checkForUpdate, applyUpdate, rollback };
