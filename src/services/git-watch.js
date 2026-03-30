const { getDb } = require('../db');
const { execSync } = require('child_process');
const { v4: uuid } = require('uuid');
const log = require('../utils/logger');

/**
 * Check for recent commits not made by DevShift and record them.
 * Called periodically by the scheduler.
 */
function detectHumanCommits() {
  const db = getDb();
  const projects = db.prepare("SELECT * FROM projects WHERE paused = 0").all();

  for (const project of projects) {
    try {
      // Get commits from last 24 hours that aren't from DevShift
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const commits = execSync(
        `git log --since="${since}" --oneline --no-merges --format="%H|%s|%an"`,
        { cwd: project.repo_path, encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (!commits) continue;

      for (const line of commits.split('\n')) {
        const [hash, message, author] = line.split('|');
        if (!hash || !message) continue;

        // Skip DevShift commits
        if (message.startsWith('devshift:') || message.includes('DevShift')) continue;

        // Check if we already tracked this commit
        const existing = db.prepare(
          "SELECT id FROM tasks WHERE project_id = ? AND execution_log LIKE ?"
        ).get(project.id, `%commit:${hash.slice(0, 8)}%`);
        if (existing) continue;

        // Record as human work
        const id = uuid();
        db.prepare(`
          INSERT INTO tasks (id, project_id, title, task_type, tier, status,
            result_summary, execution_log, completed_at)
          VALUES (?, ?, ?, 'human', 1, 'done', ?, ?, datetime('now'))
        `).run(id, project.id, message.slice(0, 200),
          `Detected commit by ${author}`, `commit:${hash.slice(0, 8)}`);

        // Store in project memory
        try {
          const { addProjectMemory, PROJECT_CATEGORIES } = require('./memory');
          addProjectMemory(project.id, PROJECT_CATEGORIES.COMPLETED, `Human committed: ${message}`, id);
        } catch {}

        log.debug(`[GitWatch] Detected human commit: ${message.slice(0, 60)}`);
      }
    } catch {
      // Not a git repo or git not available — skip silently
    }
  }
}

module.exports = { detectHumanCommits };
