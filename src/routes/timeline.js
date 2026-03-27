const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

// GET /api/timeline — unified view: completed + in_progress + planned + human tasks
router.get('/', (req, res) => {
  const db = getDb();

  const humanTasks = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE (t.status = 'waiting_human' OR t.status = 'needs_review')
      OR (t.task_type IN ('human', 'blocked') AND t.status != 'done' AND t.status != 'backlog')
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
  for (const t of [...completed, ...needsReview, ...failed]) {
    const pName = t.project_name;
    if (!byProject[pName]) byProject[pName] = { completed: 0, needsReview: 0, failed: 0, tasks: [], completedTitles: [] };
    if (t.status === 'done') {
      byProject[pName].completed++;
      byProject[pName].completedTitles.push(t.title);
    }
    if (t.status === 'needs_review') byProject[pName].needsReview++;
    if (t.status === 'failed') byProject[pName].failed++;
    byProject[pName].tasks.push(t);
  }

  // Total time saved (sum of actual_minutes from completed tasks)
  const totalTimeSaved = completed.reduce((sum, t) => sum + (t.actual_minutes || 0), 0);

  // Whether there are reviews pending
  const hasReviewsPending = needsReview.length > 0;

  // Last check-in timestamp
  const schedule = db.prepare('SELECT last_checkin FROM schedule WHERE id = 1').get();

  const sinceHours = Math.round((Date.now() - new Date(sinceDate).getTime()) / 3600000);

  res.json({
    since: sinceDate,
    sinceHours,
    summary: byProject,
    totalCompleted: completed.length,
    totalNeedsReview: needsReview.length,
    totalFailed: failed.length,
    totalTimeSaved,
    hasReviewsPending,
    lastCheckin: schedule?.last_checkin || null,
    failed,
  });
});

// GET /api/timeline/dashboard — per-project summary for command center view
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY priority ASC, created_at DESC').all();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();
  const today = new Date().toISOString().split('T')[0];

  // Batch queries — one per metric instead of N×5
  const activeTasks = db.prepare("SELECT * FROM tasks WHERE status = 'in_progress'").all();

  const completedTodayRows = db.prepare(`
    SELECT project_id, COUNT(*) as count FROM tasks
    WHERE status = 'done' AND completed_at > ?
    GROUP BY project_id
  `).all(today);

  const needsReviewRows = db.prepare(`
    SELECT project_id, COUNT(*) as count FROM tasks
    WHERE (status IN ('needs_review', 'waiting_human'))
      OR (task_type IN ('human', 'blocked') AND status != 'done' AND status != 'backlog')
    GROUP BY project_id
  `).all();

  const backlogRows = db.prepare(`
    SELECT project_id, COUNT(*) as count FROM tasks
    WHERE status IN ('backlog', 'queued') AND task_type = 'agent'
    GROUP BY project_id
  `).all();

  const nextTaskRows = db.prepare(`
    SELECT project_id, title FROM tasks
    WHERE status IN ('backlog', 'queued') AND task_type = 'agent'
    ORDER BY priority ASC,
      CASE tier WHEN 1 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 ELSE 3 END,
      created_at ASC
  `).all();

  // Build lookup maps
  const activeByProject = {};
  for (const t of activeTasks) {
    if (!activeByProject[t.project_id]) activeByProject[t.project_id] = t;
  }
  const completedTodayMap = {};
  for (const r of completedTodayRows) completedTodayMap[r.project_id] = r.count;
  const needsReviewMap = {};
  for (const r of needsReviewRows) needsReviewMap[r.project_id] = r.count;
  const backlogMap = {};
  for (const r of backlogRows) backlogMap[r.project_id] = r.count;
  const nextTaskMap = {};
  for (const r of nextTaskRows) {
    if (!nextTaskMap[r.project_id]) nextTaskMap[r.project_id] = r.title;
  }

  const projectSummaries = projects.map(project => ({
    project,
    activeTask: activeByProject[project.id] || null,
    completedToday: completedTodayMap[project.id] || 0,
    needsReview: needsReviewMap[project.id] || 0,
    backlog: backlogMap[project.id] || 0,
    nextTask: nextTaskMap[project.id] || null,
  }));

  const recentCompleted = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'done'
    ORDER BY t.completed_at DESC LIMIT 10
  `).all();

  res.json({ projects: projectSummaries, schedule, recentCompleted });
});

// GET /api/timeline/project/:id — full timeline for one project
router.get('/project/:id', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const humanTasks = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ?
      AND ((status = 'waiting_human' OR status = 'needs_review')
        OR (task_type IN ('human', 'blocked') AND status != 'done' AND status != 'backlog'))
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

  const failed = db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? AND status = 'failed'
    ORDER BY started_at DESC LIMIT 5
  `).all(projectId);

  const suggested = db.prepare(`
    SELECT t.*, parent.title as parent_title FROM tasks t
    LEFT JOIN tasks parent ON t.parent_task_id = parent.id
    WHERE t.project_id = ? AND t.status = 'suggested'
    ORDER BY t.created_at DESC
  `).all(projectId);

  res.json({ project, humanTasks, completed, inProgress, planned, failed, suggested });
});

// GET /api/timeline/usage — activity grid + per-project breakdown
router.get('/usage', (req, res) => {
  const db = getDb();
  const { range } = req.query; // 'week', 'month', or 'year'
  const daysBack = range === 'year' ? 365 : range === 'month' ? 30 : 7;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  // Daily activity (for grid)
  const dailyActivity = db.prepare(`
    SELECT DATE(started_at) as day, COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(COALESCE(estimated_credits, 0)) as credits
    FROM executions WHERE started_at > ?
    GROUP BY DATE(started_at)
    ORDER BY day ASC
  `).all(since);

  // Per-project breakdown
  const perProject = db.prepare(`
    SELECT p.id, p.name, COUNT(e.id) as total,
      SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(COALESCE(e.estimated_credits, 0)) as credits
    FROM executions e
    JOIN projects p ON e.project_id = p.id
    WHERE e.started_at > ?
    GROUP BY p.id
    ORDER BY total DESC
  `).all(since);

  // Totals
  const totals = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(COALESCE(estimated_credits, 0)) as credits
    FROM executions WHERE started_at > ?
  `).get(since);

  res.json({ dailyActivity, perProject, totals, daysBack });
});

module.exports = router;
