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

// GET /api/timeline/dashboard — per-project summary for command center view
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY priority ASC, created_at DESC').all();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  const today = new Date().toISOString().split('T')[0];

  const projectSummaries = projects.map(project => {
    const active = db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND status = 'in_progress'
    `).all(project.id);

    const completedToday = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE project_id = ? AND status = 'done' AND completed_at > ?
    `).get(project.id, today).count;

    const needsReview = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE project_id = ? AND (status = 'needs_review' OR status = 'waiting_human'
        OR (task_type = 'human' AND status != 'done'))
    `).get(project.id).count;

    const backlog = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE project_id = ? AND status IN ('backlog', 'queued') AND task_type = 'agent'
    `).get(project.id).count;

    const nextTask = db.prepare(`
      SELECT title FROM tasks
      WHERE project_id = ? AND status IN ('backlog', 'queued') AND task_type = 'agent'
      ORDER BY priority ASC,
        CASE tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT 1
    `).get(project.id);

    return {
      project,
      activeTask: active[0] || null,
      completedToday,
      needsReview,
      backlog,
      nextTask: nextTask?.title || null,
    };
  });

  res.json({ projects: projectSummaries, schedule });
});

// GET /api/timeline/project/:id — full timeline for one project
router.get('/project/:id', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const humanTasks = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ?
      AND (task_type IN ('human', 'blocked') OR status = 'waiting_human' OR status = 'needs_review')
    ORDER BY priority ASC, created_at DESC
  `).all(projectId);

  const completed = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? AND status = 'done'
    ORDER BY completed_at DESC LIMIT 20
  `).all(projectId);

  const inProgress = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? AND status = 'in_progress'
  `).all(projectId);

  const planned = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ?
      AND status IN ('backlog', 'queued') AND task_type = 'agent'
    ORDER BY priority ASC,
      CASE tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      created_at ASC
    LIMIT 20
  `).all(projectId);

  res.json({ project, humanTasks, completed, inProgress, planned });
});

module.exports = router;
