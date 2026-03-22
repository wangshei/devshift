const { execSync } = require('child_process');
const log = require('../utils/logger');

/**
 * Create a PR using the gh CLI (avoids needing Octokit dependency).
 * Falls back gracefully if gh is not installed.
 */
function createPR({ repoPath, title, body, head, base = 'main' }) {
  try {
    execSync('which gh', { stdio: 'ignore' });
  } catch {
    log.warn('gh CLI not installed — skipping PR creation');
    return null;
  }

  try {
    const safeTitle = title.replace(/"/g, '\\"');
    const safeBody = (body || '').replace(/"/g, '\\"');
    const result = execSync(
      `gh pr create --title "${safeTitle}" --body "${safeBody}" --head "${head}" --base "${base}"`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 30000 }
    ).trim();

    // gh pr create outputs the PR URL
    const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);
    const prUrl = urlMatch ? urlMatch[0] : result;

    // Get PR number
    const numMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = numMatch ? parseInt(numMatch[1], 10) : null;

    log.info(`Created PR: ${prUrl}`);
    return { url: prUrl, number: prNumber };
  } catch (e) {
    log.error('Failed to create PR:', e.message);
    return null;
  }
}

/**
 * Merge a PR using gh CLI.
 */
function mergePR({ repoPath, prNumber, method = 'squash' }) {
  try {
    execSync(
      `gh pr merge ${prNumber} --${method} --delete-branch`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 30000 }
    );
    log.info(`Merged PR #${prNumber}`);
    return true;
  } catch (e) {
    log.error(`Failed to merge PR #${prNumber}:`, e.message);
    return false;
  }
}

module.exports = { createPR, mergePR };
