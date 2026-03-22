const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Generate a changelog entry for recently completed tasks.
 */
function generateChangelog(projectId) {
  const db = getDb();

  // Get tasks completed since the last changelog entry for this project
  const lastEntry = db.prepare(`
    SELECT timestamp FROM changelog WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1
  `).get(projectId);

  const since = lastEntry ? lastEntry.timestamp : '2000-01-01';

  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE project_id = ? AND status = 'done' AND completed_at > ?
    ORDER BY completed_at ASC
  `).all(projectId, since);

  if (tasks.length === 0) return null;

  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);

  // Build summary
  const autoMerged = tasks.filter(t => t.tier === 1);
  const reviewed = tasks.filter(t => t.tier !== 1);
  const summaryLines = [];

  if (autoMerged.length) {
    summaryLines.push(`${autoMerged.length} auto-merged: ${autoMerged.map(t => t.title).join(', ')}`);
  }
  if (reviewed.length) {
    summaryLines.push(`${reviewed.length} reviewed: ${reviewed.map(t => t.title).join(', ')}`);
  }

  const summary = `${project.name}: ${tasks.length} tasks completed. ${summaryLines.join('. ')}`;

  const id = uuid();
  db.prepare(`
    INSERT INTO changelog (id, project_id, summary, tasks_completed)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, summary, JSON.stringify(tasks.map(t => t.id)));

  log.info(`Changelog entry created for ${project.name}: ${tasks.length} tasks`);
  return { id, summary };
}

/**
 * Generate changelog entries for all projects with recent completions.
 */
function generateAllChangelogs() {
  const db = getDb();
  const projects = db.prepare('SELECT id FROM projects').all();
  const results = [];
  for (const p of projects) {
    const entry = generateChangelog(p.id);
    if (entry) results.push(entry);
  }
  return results;
}

module.exports = { generateChangelog, generateAllChangelogs };
