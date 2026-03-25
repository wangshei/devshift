const { Router } = require('express');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getDb } = require('../db');

const router = Router();

// GET /api/projects
router.get('/', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY priority ASC, created_at DESC').all();
  res.json(projects);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// POST /api/projects
router.post('/', (req, res) => {
  const db = getDb();
  const { name, repo_path, github_remote, context, preferences, priority } = req.body;

  if (!name || !repo_path) {
    return res.status(400).json({ error: 'name and repo_path are required' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, repo_path, github_remote, context, preferences, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, repo_path, github_remote || null, context || null,
    preferences ? JSON.stringify(preferences) : null, priority || 5);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

// PATCH /api/projects/:id
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  const fields = ['name', 'repo_path', 'github_remote', 'context', 'preferences',
    'status_summary', 'priority', 'paused', 'focus_mode', 'auto_approve_tiers'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      const val = field === 'preferences' && typeof req.body[field] === 'object'
        ? JSON.stringify(req.body[field]) : req.body[field];
      values.push(val);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(project);
});

// POST /api/projects/:id/focus — toggle focus mode (sets this project focus=1, all others focus=0)
router.post('/:id/focus', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE projects SET focus_mode = 0').run();
  const { enable } = req.body; // true to enable, false to disable
  if (enable) db.prepare('UPDATE projects SET focus_mode = 1 WHERE id = ?').run(req.params.id);
  res.json({ focused: !!enable });
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// POST /api/projects/pick-folder — open native folder picker (macOS)
router.post('/pick-folder', (req, res) => {
  try {
    const result = execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "Choose a project folder")'`,
      { encoding: 'utf-8', timeout: 60000 }
    ).trim().replace(/\/+$/, '');
    if (!result) return res.status(400).json({ error: 'No folder selected' });
    res.json({ path: result });
  } catch (e) {
    // User cancelled the dialog
    if (e.status === 1 || e.message?.includes('User canceled')) {
      return res.json({ path: null, cancelled: true });
    }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects/from-path — one-click add from a directory path
router.post('/from-path', (req, res) => {
  const db = getDb();
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'path is required' });

  const cleanPath = dirPath.trim().replace(/\/+$/, '');
  if (!fs.existsSync(cleanPath) || !fs.statSync(cleanPath).isDirectory()) {
    return res.status(400).json({ error: 'Path does not exist or is not a directory' });
  }

  // Check if already added
  const existing = db.prepare('SELECT * FROM projects WHERE repo_path = ?').get(cleanPath);
  if (existing) return res.status(409).json({ error: 'Project already added', project: existing });

  // Auto-detect name from package.json or folder name
  let name = path.basename(cleanPath);
  let context = null;
  const pkgPath = path.join(cleanPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.description) context = pkg.description;
    } catch { /* ignore */ }
  }

  // Auto-detect git remote
  let githubRemote = null;
  try {
    githubRemote = execSync('git remote get-url origin', {
      cwd: cleanPath, encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch { /* no remote */ }

  // Read CLAUDE.md if present
  const claudePath = path.join(cleanPath, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    try {
      const claudeContent = fs.readFileSync(claudePath, 'utf-8').slice(0, 1000);
      context = context ? `${context}\n\n${claudeContent}` : claudeContent;
    } catch { /* ignore */ }
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, repo_path, github_remote, context, paused, focus_mode)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `).run(id, name, cleanPath, githubRemote, context);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

// POST /api/projects/create-new — create a new project directory and register it
router.post('/create-new', async (req, res) => {
  const { name, location, initGit } = req.body;
  if (!name || !location) return res.status(400).json({ error: 'name and location required' });

  const os = require('os');
  const cleanLocation = location.replace(/^~/, os.homedir());
  const projectPath = path.join(cleanLocation, name);

  if (fs.existsSync(projectPath)) {
    return res.status(400).json({ error: `Directory already exists: ${projectPath}` });
  }

  try {
    fs.mkdirSync(projectPath, { recursive: true });
    if (initGit) {
      execSync('git init', { cwd: projectPath, encoding: 'utf-8' });
    }
    // Add as project
    const db = getDb();
    const id = uuid();
    db.prepare('INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)').run(id, name, projectPath);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/projects/:id/knowledge — everything the agent knows about a project
router.get('/:id/knowledge', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const knowledge = { project };

  // 1. Read CLAUDE.md if it exists
  const claudePath = path.join(project.repo_path, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    knowledge.claudeMd = fs.readFileSync(claudePath, 'utf-8');
  }

  // 2. Read package.json for dependencies/stack
  const pkgPath = path.join(project.repo_path, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      knowledge.packageInfo = {
        name: pkg.name,
        description: pkg.description,
        scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
      };
    } catch { /* ignore */ }
  }

  // 3. Git info — recent commits, current branch, file count
  try {
    knowledge.git = {
      branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: project.repo_path, encoding: 'utf-8', timeout: 5000 }).trim(),
      recentCommits: execSync('git log --oneline -10', { cwd: project.repo_path, encoding: 'utf-8', timeout: 5000 }).trim().split('\n'),
      fileCount: parseInt(execSync('git ls-files | wc -l', { cwd: project.repo_path, encoding: 'utf-8', timeout: 5000 }).trim()),
    };
  } catch { knowledge.git = null; }

  // 4. Project preferences (JSON rules)
  knowledge.preferences = [];
  if (project.preferences) {
    try { knowledge.preferences = JSON.parse(project.preferences); } catch { /* ignore */ }
  }

  // 5. Task stats
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM tasks WHERE project_id = ?').get(project.id).c,
    done: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'done'").get(project.id).c,
    failed: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'failed'").get(project.id).c,
    backlog: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status IN ('backlog','queued')").get(project.id).c,
    needsReview: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'needs_review'").get(project.id).c,
  };
  knowledge.stats = stats;

  // 6. Recent completed tasks (what agent has done)
  knowledge.recentWork = db.prepare(`
    SELECT title, result_summary, completed_at, actual_minutes, provider
    FROM tasks WHERE project_id = ? AND status = 'done'
    ORDER BY completed_at DESC LIMIT 10
  `).all(project.id);

  res.json(knowledge);
});

// POST /api/projects/:id/preferences — update project rules
router.post('/:id/preferences', (req, res) => {
  const db = getDb();
  const { preferences } = req.body; // array of strings
  db.prepare('UPDATE projects SET preferences = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(preferences), req.params.id);
  res.json({ saved: true });
});

module.exports = router;
