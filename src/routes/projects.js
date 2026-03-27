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

// GET /api/projects/standards/defaults
router.get('/standards/defaults', (req, res) => {
  res.json([
    { category: 'Testing', rule: 'Write tests for new functions and modified code' },
    { category: 'Testing', rule: 'Maintain or improve existing test coverage' },
    { category: 'Code Style', rule: 'Follow existing code style and naming conventions' },
    { category: 'Code Style', rule: 'Keep functions small and focused' },
    { category: 'PRs', rule: 'Keep changes focused — one concern per PR' },
    { category: 'PRs', rule: 'Write clear commit messages explaining why, not what' },
    { category: 'Safety', rule: 'Never modify database schema without explicit approval' },
    { category: 'Safety', rule: 'Never delete data or remove features without approval' },
    { category: 'Safety', rule: 'Never commit secrets, credentials, or API keys' },
    { category: 'Documentation', rule: 'Update README when adding new features or changing setup' },
  ]);
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
    'status_summary', 'priority', 'paused', 'focus_mode', 'auto_approve_tiers',
    'goal_md', 'goal_approved', 'services'];
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

// POST /api/projects/:id/detect-services — re-scan project for external services
router.post('/:id/detect-services', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const services = {};
  const cleanPath = project.repo_path;

  // GitHub
  if (project.github_remote) {
    const ghMatch = project.github_remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (ghMatch) services.github = `https://github.com/${ghMatch[1]}`;
  }
  // Vercel
  if (fs.existsSync(path.join(cleanPath, 'vercel.json')) || fs.existsSync(path.join(cleanPath, '.vercel'))) {
    try {
      const vc = JSON.parse(fs.readFileSync(path.join(cleanPath, '.vercel', 'project.json'), 'utf-8'));
      if (vc.projectId) services.vercel = `https://vercel.com/~/projects/${vc.projectId}`;
    } catch {}
    if (!services.vercel) services.vercel = 'https://vercel.com/dashboard';
  }
  // Supabase
  try {
    for (const ef of ['.env', '.env.local', '.env.development']) {
      const envPath = path.join(cleanPath, ef);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const m = envContent.match(/SUPABASE_URL=https?:\/\/([^.]+)\.supabase\.co/);
        if (m) { services.supabase = `https://supabase.com/dashboard/project/${m[1]}`; break; }
      }
    }
  } catch {}
  if (!services.supabase && fs.existsSync(path.join(cleanPath, 'supabase'))) {
    services.supabase = 'https://supabase.com/dashboard';
  }
  // Railway
  if (fs.existsSync(path.join(cleanPath, 'railway.toml'))) services.railway = 'https://railway.app/dashboard';
  // Netlify
  if (fs.existsSync(path.join(cleanPath, 'netlify.toml'))) services.netlify = 'https://app.netlify.com';

  db.prepare("UPDATE projects SET services = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(services), req.params.id);

  res.json({ services, detected: Object.keys(services).length });
});

// POST /api/projects/:id/goal — save and optionally approve the project goal
router.post('/:id/goal', (req, res) => {
  const db = getDb();
  const { goal_md, approved } = req.body;
  db.prepare("UPDATE projects SET goal_md = ?, goal_approved = ?, updated_at = datetime('now') WHERE id = ?")
    .run(goal_md, approved ? 1 : 0, req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(project);
});

// POST /api/projects/:id/generate-goal-stream — SSE stream of goal generation progress
router.post('/:id/generate-goal-stream', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const existingGoal = project.goal_md;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('progress', { step: 'Reading project files...' });

  // Gather project info for context
  let projectInfo = '';
  try {
    for (const rp of ['README.md', 'readme.md']) {
      const fp = path.join(project.repo_path, rp);
      if (fs.existsSync(fp)) {
        projectInfo += `README found (${fs.statSync(fp).size} bytes)\n`;
        send('progress', { step: 'Reading README.md...' });
        break;
      }
    }
    const pkgPath = path.join(project.repo_path, 'package.json');
    if (fs.existsSync(pkgPath)) {
      send('progress', { step: 'Reading package.json...' });
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      projectInfo += `package.json: ${pkg.name || 'unknown'} - ${pkg.description || 'no description'}\n`;
    }
    const claudePath = path.join(project.repo_path, 'CLAUDE.md');
    if (fs.existsSync(claudePath)) {
      send('progress', { step: 'Reading CLAUDE.md...' });
    }

    // Count source files
    const entries = fs.readdirSync(project.repo_path, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').length;
    send('progress', { step: `Found ${dirs} directories, analyzing structure...` });
  } catch {}

  send('progress', { step: 'Sending to Claude for analysis...' });

  // Build prompt
  let prompt;
  if (existingGoal && existingGoal.length > 50) {
    prompt = `You are in the project directory for "${project.name}". Read the codebase — look at README.md, package.json, key source files, and the directory structure. Then UPDATE this existing product goal:\n\n---\n${existingGoal}\n---\n\nKeep what's still accurate, update what's changed, add new features from the code. Under 400 words. Output ONLY the updated markdown.`;
  } else {
    prompt = `You are in the project directory for "${project.name}". Read the codebase — README.md, package.json, CLAUDE.md, source files, directory structure. Write a product goal in markdown: what this is (1 sentence), who it's for, core features (bullet list), tech stack, what "done" looks like. Under 400 words. Be specific based on actual code. Output ONLY markdown.`;
  }

  // Spawn claude (non-blocking) and stream output
  const { spawn } = require('child_process');
  const proc = spawn('claude', ['-p', '--output-format', 'text'], {
    cwd: project.repo_path,
    timeout: 120000,
  });

  let output = '';
  let lineCount = 0;

  proc.stdin.write(prompt);
  proc.stdin.end();

  send('progress', { step: 'Claude is reading your codebase...' });

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    lineCount++;
    // Send progress updates as Claude generates
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const preview = lines[0].slice(0, 80);
      send('progress', { step: `Writing: ${preview}${preview.length >= 80 ? '...' : ''}` });
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('Reading') || text.includes('Analyzing') || text.includes('Searching')) {
      send('progress', { step: text.trim().slice(0, 100) });
    }
  });

  proc.on('close', (code) => {
    if (code !== 0 || !output || output.length < 30) {
      send('error', { message: 'Claude failed to generate goal' });
      res.end();
      return;
    }

    // Clean output
    let cleaned = output.trim();
    const mdStart = cleaned.indexOf('# ');
    if (mdStart > 0 && mdStart < 100) cleaned = cleaned.slice(mdStart);

    // Save to DB
    db.prepare("UPDATE projects SET goal_md = ?, goal_approved = 0, updated_at = datetime('now') WHERE id = ?")
      .run(cleaned, req.params.id);

    send('progress', { step: 'Goal saved as draft' });
    send('done', { goal_md: cleaned, updated: !!existingGoal });
    res.end();
  });

  proc.on('error', (err) => {
    send('error', { message: err.message });
    res.end();
  });

  // Cleanup if client disconnects
  req.on('close', () => {
    proc.kill('SIGTERM');
  });
});

// POST /api/projects/:id/generate-goal — auto-generate a goal from project files
// Runs Claude IN the project directory so it can read actual source code.
// If a goal already exists, asks Claude to update it rather than replace it.
router.post('/:id/generate-goal', async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const existingGoal = project.goal_md;

  // Build prompt — Claude runs in the project dir so it can read files itself
  let prompt;
  if (existingGoal && existingGoal.length > 50) {
    // Update existing goal based on current code state
    prompt = `You are in the project directory for "${project.name}".

Read the codebase — look at README.md, package.json, key source files, and the directory structure.
Then UPDATE this existing product goal to reflect the current state of the code:

---
${existingGoal}
---

Rules:
- Keep what's still accurate, update what's changed
- Add any new features you see in the code that aren't in the goal
- Mark completed features if you can tell from the code
- Keep the same markdown format
- Be specific — reference actual files, routes, components you find
- Under 400 words

Output ONLY the updated markdown goal document, nothing else.`;
  } else {
    // Generate fresh goal from code
    prompt = `You are in the project directory for "${project.name}".

Read the codebase — look at README.md, package.json, CLAUDE.md, key source files, directory structure, and any docs/ folder.

Write a product goal document in markdown that describes:
1. **What this is** — one sentence based on what the code actually does
2. **Who it's for** — target users based on the UI/features you see
3. **Core features** — bullet list of what exists AND what's planned/incomplete
4. **Tech stack** — frameworks, databases, APIs you find in the code
5. **What "done" looks like** — the end state vision

Rules:
- Be specific — reference actual files, routes, components
- Under 400 words
- Use markdown headers and bullet lists
- Don't be generic — every line should be based on something you read in the code

Output ONLY the markdown document, nothing else.`;
  }

  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
      cwd: project.repo_path,
      input: prompt,
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Exit code ${result.status}`);

    let output = result.stdout.trim();
    // Strip any "Here's the..." preamble if Claude adds one
    const mdStart = output.indexOf('# ');
    if (mdStart > 0 && mdStart < 100) output = output.slice(mdStart);

    if (!output || output.length < 30) throw new Error('Empty or too-short response from Claude');

    db.prepare("UPDATE projects SET goal_md = ?, goal_approved = 0, updated_at = datetime('now') WHERE id = ?")
      .run(output, req.params.id);

    res.json({ goal_md: output, generated: true, updated: !!existingGoal });
  } catch (e) {
    // Fallback: read what we can without Claude
    let goalLines = [`# ${project.name}\n`];
    const pkgPath2 = path.join(project.repo_path, 'package.json');
    let description = '';
    let stack = [];
    if (fs.existsSync(pkgPath2)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath2, 'utf-8'));
        if (pkg.description) description = pkg.description;
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react || deps.next) stack.push('React');
        if (deps.express || deps.fastify) stack.push('Node.js');
        if (deps.typescript) stack.push('TypeScript');
        if (deps.tailwindcss) stack.push('Tailwind');
        if (deps.prisma) stack.push('Prisma');
        if (deps.supabase || deps['@supabase/supabase-js']) stack.push('Supabase');
      } catch {}
    }
    // Try README for description
    if (!description) {
      for (const rp of ['README.md', 'readme.md']) {
        const fp = path.join(project.repo_path, rp);
        if (fs.existsSync(fp)) {
          const readme = fs.readFileSync(fp, 'utf-8');
          const firstPara = readme.split('\n\n').find(p => p.trim() && !p.startsWith('#'));
          if (firstPara) { description = firstPara.trim().slice(0, 200); break; }
        }
      }
    }

    if (description) goalLines.push(`${description}\n`);
    else goalLines.push(`> Could not auto-generate — Claude CLI timed out. Edit this manually.\n`);

    goalLines.push(`## Tech Stack`);
    if (stack.length) goalLines.push(stack.map(s => `- ${s}`).join('\n'));

    goalLines.push(`\n## Core Features\n_Run "Generate from code" again or fill in manually._`);
    goalLines.push(`\n## What "Done" Looks Like\n_Describe the end state of this product._`);

    const template = goalLines.join('\n');
    db.prepare("UPDATE projects SET goal_md = ?, goal_approved = 0, updated_at = datetime('now') WHERE id = ?")
      .run(template, req.params.id);

    res.json({ goal_md: template, generated: true, fallback: true, error: e.message });
  }
});

// POST /api/projects/:id/toggle-pause
router.post('/:id/toggle-pause', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const newPaused = project.paused ? 0 : 1;
  db.prepare("UPDATE projects SET paused = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newPaused, req.params.id);
  res.json({ paused: !!newPaused });
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

  // Auto-detect services
  const services = {};

  // GitHub
  if (githubRemote) {
    const ghMatch = githubRemote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (ghMatch) services.github = `https://github.com/${ghMatch[1]}`;
  }

  // Vercel (check vercel.json or .vercel directory)
  if (fs.existsSync(path.join(cleanPath, 'vercel.json')) || fs.existsSync(path.join(cleanPath, '.vercel'))) {
    try {
      const vercelDir = path.join(cleanPath, '.vercel', 'project.json');
      if (fs.existsSync(vercelDir)) {
        const vc = JSON.parse(fs.readFileSync(vercelDir, 'utf-8'));
        if (vc.projectId) services.vercel = `https://vercel.com/~/projects/${vc.projectId}`;
      }
    } catch {}
    if (!services.vercel) services.vercel = 'https://vercel.com/dashboard';
  }

  // Supabase (check .env or supabase config)
  try {
    const envFiles = ['.env', '.env.local', '.env.development'];
    for (const ef of envFiles) {
      const envPath = path.join(cleanPath, ef);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const supaMatch = envContent.match(/SUPABASE_URL=https?:\/\/([^.]+)\.supabase\.co/);
        if (supaMatch) {
          services.supabase = `https://supabase.com/dashboard/project/${supaMatch[1]}`;
          break;
        }
      }
    }
  } catch {}
  if (fs.existsSync(path.join(cleanPath, 'supabase'))) {
    services.supabase = services.supabase || 'https://supabase.com/dashboard';
  }

  // Railway (check railway.toml or .railway)
  if (fs.existsSync(path.join(cleanPath, 'railway.toml')) || fs.existsSync(path.join(cleanPath, '.railway'))) {
    services.railway = 'https://railway.app/dashboard';
  }

  // Netlify
  if (fs.existsSync(path.join(cleanPath, 'netlify.toml')) || fs.existsSync(path.join(cleanPath, '.netlify'))) {
    services.netlify = 'https://app.netlify.com';
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, repo_path, github_remote, context, services, paused, focus_mode)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `).run(id, name, cleanPath, githubRemote, context, JSON.stringify(services));

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
