const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { git, branchDiffStat, mergeBranch, deleteBranch, checkout, getDefaultBranch } = require('../utils/git');
const log = require('../utils/logger');

const REPO_ROOT = path.resolve(__dirname, '../..');
const STATE_FILE = path.join(REPO_ROOT, 'data', 'self-update-state.json');

/**
 * Check for pending update branches (devshift/*).
 * @returns {{ branch: string, diffStat: string, commitCount: number }[]}
 */
function checkForUpdate() {
  const raw = git(REPO_ROOT, 'branch', '--list', "'devshift/*'");
  if (!raw) return [];

  const defaultBranch = getDefaultBranch(REPO_ROOT);
  const branches = raw.split('\n').map(b => b.replace(/^\*?\s+/, '')).filter(Boolean);

  return branches.map(branch => {
    const diffStat = branchDiffStat(REPO_ROOT, branch, defaultBranch);
    let commitCount = 0;
    try {
      const countStr = git(REPO_ROOT, 'rev-list', '--count', `${defaultBranch}..${branch}`);
      commitCount = parseInt(countStr, 10) || 0;
    } catch {
      // branch may not have diverged
    }
    return { branch, diffStat, commitCount };
  });
}

/**
 * Apply an update from a devshift/* branch.
 * @param {string} branchName
 * @returns {{ success: boolean, previousCommit: string, branch: string }}
 */
function applyUpdate(branchName) {
  // Verify branch exists
  try {
    git(REPO_ROOT, 'rev-parse', '--verify', branchName);
  } catch {
    throw new Error(`Branch "${branchName}" does not exist`);
  }

  const previousCommit = git(REPO_ROOT, 'rev-parse', 'HEAD');

  // Store rollback state
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    previousCommit,
    appliedAt: new Date().toISOString(),
    branch: branchName,
  }, null, 2));

  // Build
  try {
    execSync('npm run build', { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 120000, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`Build failed: ${e.stdout || ''}\n${e.stderr || ''}`);
  }

  // Verify module loads
  try {
    execSync(`node -e "require('./src/services/self-update')"`, { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`Module verification failed: ${e.stdout || ''}\n${e.stderr || ''}`);
  }

  // Merge
  const defaultBranch = getDefaultBranch(REPO_ROOT);
  checkout(REPO_ROOT, defaultBranch);
  mergeBranch(REPO_ROOT, branchName);
  deleteBranch(REPO_ROOT, branchName);

  log.info(`Applied update from ${branchName}, previous HEAD: ${previousCommit}`);
  return { success: true, previousCommit, branch: branchName };
}

/**
 * Roll back the last applied update.
 * @returns {{ success: boolean, restoredCommit: string }}
 */
function rollback() {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error('No update state found — nothing to roll back');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  git(REPO_ROOT, 'reset', '--hard', state.previousCommit);
  fs.unlinkSync(STATE_FILE);

  log.info(`Rolled back to ${state.previousCommit}`);
  return { success: true, restoredCommit: state.previousCommit };
}

module.exports = { checkForUpdate, applyUpdate, rollback };
