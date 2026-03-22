const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

// GET /api/timeline — unified view: completed + in_progress + planned + human tasks
router.get('/', (req, res) => {
  const db = getDb();

  const humanTasks = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.task_type IN ('human', 'blocked') OR t.status = 'waiting_human' OR t.status = 'needs_review'
    ORDER BY t.priority ASC, t.created_at DESC
  `).all();

  const completed = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done'
    ORDER BY t.completed_at DESC
    LIMIT 20
  `).all();

  const inProgress = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'in_progress'
  `).all();

  const planned = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status IN ('backlog', 'queued') AND t.task_type = 'agent'
    ORDER BY t.priority ASC,
      CASE t.tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      t.created_at ASC
    LIMIT 20
  `).all();

  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();

  res.json({ humanTasks, completed, inProgress, planned, schedule });
});

// GET /api/timeline/digest — summary since last check-in
router.get('/digest', (req, res) => {
  const db = getDb();
  const { since } = req.query;
  const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const completed = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done' AND t.completed_at > ?
    ORDER BY t.completed_at DESC
  `).all(sinceDate);

  const needsReview = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'needs_review'
    ORDER BY t.completed_at DESC
  `).all();

  const failed = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'failed' AND t.started_at > ?
    ORDER BY t.started_at DESC
  `).all(sinceDate);

  // Group by project
  const byProject = {};
  for (const t of [...completed, ...needsReview]) {
    const pName = t.project_name;
    if (!byProject[pName]) byProject[pName] = { completed: 0, needsReview: 0, tasks: [] };
    if (t.status === 'done') byProject[pName].completed++;
    if (t.status === 'needs_review') byProject[pName].needsReview++;
    byProject[pName].tasks.push(t);
  }

  const sinceHours = Math.round((Date.now() - new Date(sinceDate).getTime()) / 3600000);

  res.json({
    since: sinceDate,
    sinceHours,
    summary: byProject,
    totalCompleted: completed.length,
    totalNeedsReview: needsReview.length,
    totalFailed: failed.length,
    failed,
  });
});

module.exports = router;
