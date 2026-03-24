const { execSync } = require('child_process');
const log = require('./logger');

/**
 * Run a git command in a repo directory.
 */
function git(repoPath, ...args) {
  const cmd = `git ${args.join(' ')}`;
  log.debug(`[git] ${cmd} in ${repoPath}`);
  return execSync(cmd, { cwd: repoPath, encoding: 'utf-8', timeout: 30000 }).trim();
}

/**
 * Get the current branch name.
 */
function currentBranch(repoPath) {
  return git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/**
 * Create and checkout a new branch from the current branch.
 */
function createBranch(repoPath, branchName) {
  const current = currentBranch(repoPath);
  try {
    git(repoPath, 'checkout', '-b', branchName);
    log.info(`Created branch ${branchName} from ${current}`);
    return branchName;
  } catch (e) {
    // Branch might already exist
    git(repoPath, 'checkout', branchName);
    return branchName;
  }
}

/**
 * Stage all changes and commit.
 */
function commitAll(repoPath, message) {
  git(repoPath, 'add', '-A');

  // Check if there are staged changes
  try {
    git(repoPath, 'diff', '--cached', '--quiet');
    log.info('No changes to commit');
    return null;
  } catch {
    // diff --quiet returns non-zero when there are changes
  }

  const safeMsg = message.replace(/'/g, "'\\''");
  git(repoPath, 'commit', '-m', `'${safeMsg}'`);
  const hash = git(repoPath, 'rev-parse', '--short', 'HEAD');
  log.info(`Committed ${hash}: ${message}`);
  return hash;
}

/**
 * Push branch to remote.
 */
function push(repoPath, branchName, remote = 'origin') {
  git(repoPath, 'push', '-u', remote, branchName);
  log.info(`Pushed ${branchName} to ${remote}`);
}

/**
 * Checkout an existing branch.
 */
function checkout(repoPath, branchName) {
  git(repoPath, 'checkout', branchName);
}

/**
 * Tag the current commit.
 */
function tag(repoPath, tagName, message) {
  const safeMsg = message.replace(/'/g, "'\\''");
  git(repoPath, 'tag', '-a', tagName, '-m', `'${safeMsg}'`);
  log.info(`Tagged ${tagName}`);
}

/**
 * Check if there are uncommitted changes.
 */
function hasChanges(repoPath) {
  const status = git(repoPath, 'status', '--porcelain');
  return status.length > 0;
}

/**
 * Get a summary of changes (files changed).
 */
function diffSummary(repoPath) {
  try {
    return git(repoPath, 'diff', '--stat', 'HEAD~1');
  } catch {
    return '';
  }
}

/**
 * Get the full diff of a branch against main.
 */
function branchDiff(repoPath, branchName, baseBranch = 'main') {
  try {
    return git(repoPath, 'diff', `${baseBranch}...${branchName}`);
  } catch {
    try { return git(repoPath, 'diff', `master...${branchName}`); }
    catch { return ''; }
  }
}

/**
 * Get diff stat (files changed summary) for a branch against main.
 */
function branchDiffStat(repoPath, branchName, baseBranch = 'main') {
  try {
    return git(repoPath, 'diff', '--stat', `${baseBranch}...${branchName}`);
  } catch {
    try { return git(repoPath, 'diff', '--stat', `master...${branchName}`); }
    catch { return ''; }
  }
}

/**
 * Merge a branch into the current branch (fast-forward or merge commit).
 */
function mergeBranch(repoPath, branchName) {
  git(repoPath, 'merge', branchName, '--no-edit');
  log.info(`Merged ${branchName}`);
}

/**
 * Delete a local branch.
 */
function deleteBranch(repoPath, branchName) {
  git(repoPath, 'branch', '-D', branchName);
  log.info(`Deleted branch ${branchName}`);
}

/**
 * Get the default branch name (main or master).
 */
function getDefaultBranch(repoPath) {
  try {
    git(repoPath, 'rev-parse', '--verify', 'main');
    return 'main';
  } catch {
    try {
      git(repoPath, 'rev-parse', '--verify', 'master');
      return 'master';
    } catch {
      return currentBranch(repoPath);
    }
  }
}

module.exports = {
  git, currentBranch, createBranch, commitAll, push,
  checkout, tag, hasChanges, diffSummary,
  branchDiff, branchDiffStat, mergeBranch, deleteBranch, getDefaultBranch,
};
