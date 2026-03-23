const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getDb } = require('../db');
const { detectProviders } = require('../providers');

const router = Router();

// Lazy-load provider instances for testing
function getProviderInstance(id) {
  const providers = {
    claude_code: () => new (require('../providers/claude-code'))(),
    antigravity: () => new (require('../providers/antigravity'))(),
    cursor: () => new (require('../providers/cursor'))(),
  };
  return providers[id] ? providers[id]() : null;
}

// GET /api/setup/status
router.get('/status', (req, res) => {
  const db = getDb();
  const schedule = db.prepare('SELECT setup_complete FROM schedule WHERE id = 1').get();
  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
  const providerCount = db.prepare("SELECT COUNT(*) as count FROM providers WHERE enabled = 1").get().count;

  // Auto-detect providers
  const detected = detectProviders();

  res.json({
    needsSetup: !schedule.setup_complete,
    hasProjects: projectCount > 0,
    hasProviders: providerCount > 0,
    projectCount,
    detectedProviders: detected,
  });
});

// POST /api/setup/complete
router.post('/complete', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE schedule SET setup_complete = 1 WHERE id = 1').run();
  res.json({ done: true });
});

// POST /api/providers/:id/test — smoke test a provider
router.post('/providers/:id/test', async (req, res) => {
  const provider = getProviderInstance(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Unknown provider' });

  try {
    const result = await provider.test();
    // Update auth_status in DB
    const db = getDb();
    db.prepare('UPDATE providers SET auth_status = ? WHERE id = ?')
      .run(result.connected ? 'authenticated' : 'failed', req.params.id);
    res.json(result);
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// POST /api/projects/scan — auto-detect project info from a path
router.post('/projects/scan', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'path is required' });

  const cleanPath = dirPath.trim().replace(/\/+$/, '');

  // Check path exists
  if (!fs.existsSync(cleanPath) || !fs.statSync(cleanPath).isDirectory()) {
    return res.status(400).json({ error: 'Path does not exist or is not a directory' });
  }

  // Auto-detect project info
  const info = { path: cleanPath, name: path.basename(cleanPath) };

  // Try package.json for name
  const pkgPath = path.join(cleanPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) info.name = pkg.name;
      if (pkg.description) info.context = pkg.description;
      info.stack = [];
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) info.stack.push('React');
      if (deps.next) info.stack.push('Next.js');
      if (deps.vue) info.stack.push('Vue');
      if (deps.express) info.stack.push('Express');
      if (deps.fastify) info.stack.push('Fastify');
      if (deps.tailwindcss || deps['@tailwindcss/vite']) info.stack.push('Tailwind');
      if (deps.prisma || deps['@prisma/client']) info.stack.push('Prisma');
      if (deps.typescript) info.stack.push('TypeScript');
    } catch { /* ignore */ }
  }

  // Try Cargo.toml
  if (fs.existsSync(path.join(cleanPath, 'Cargo.toml'))) {
    info.stack = info.stack || [];
    info.stack.push('Rust');
  }

  // Try pyproject.toml / requirements.txt
  if (fs.existsSync(path.join(cleanPath, 'pyproject.toml')) ||
      fs.existsSync(path.join(cleanPath, 'requirements.txt'))) {
    info.stack = info.stack || [];
    info.stack.push('Python');
  }

  // Try go.mod
  if (fs.existsSync(path.join(cleanPath, 'go.mod'))) {
    info.stack = info.stack || [];
    info.stack.push('Go');
  }

  // Git remote
  try {
    info.github_remote = execSync('git remote get-url origin', {
      cwd: cleanPath, encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch { /* no remote */ }

  // Check for CLAUDE.md
  const claudePath = path.join(cleanPath, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    try {
      const content = fs.readFileSync(claudePath, 'utf-8');
      info.claudeContext = content.slice(0, 500);
    } catch { /* ignore */ }
  }

  // Check if already added
  const db = getDb();
  const existing = db.prepare('SELECT id, name FROM projects WHERE repo_path = ?').get(cleanPath);
  if (existing) info.alreadyAdded = existing.name;

  res.json(info);
});

module.exports = router;
