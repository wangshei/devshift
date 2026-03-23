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
    'status_summary', 'priority'];
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

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
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
      if (pkg.name) name = pkg.name;
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
    INSERT INTO projects (id, name, repo_path, github_remote, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, cleanPath, githubRemote, context);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

module.exports = router;
