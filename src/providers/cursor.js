const { spawn, execSync } = require('child_process');
const BaseProvider = require('./base');
const log = require('../utils/logger');

class CursorProvider extends BaseProvider {
  constructor() {
    super('cursor', 'Cursor', 'cursor');
  }

  async detect() {
    try {
      execSync('which cursor', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async test() {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.HOME || process.env.USERPROFILE || '';

    let account = null;

    // Try ~/.cursor/ for any JSON config with email
    const cursorConfigPaths = [
      path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
    ];
    // Also scan ~/.cursor/ for JSON files
    try {
      const cursorDir = path.join(home, '.cursor');
      const files = fs.readdirSync(cursorDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        cursorConfigPaths.push(path.join(cursorDir, f));
      }
    } catch { /* dir not readable */ }

    for (const p of cursorConfigPaths) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        account = data.email || data.account || data['cursor.email'] || null;
        if (account) break;
      } catch { /* skip */ }
    }

    // Check CLI first
    try {
      execSync('which cursor', { stdio: 'ignore', timeout: 5000 });
      return { connected: true, account: account || null, output: 'Cursor CLI found on PATH' };
    } catch { /* not on PATH */ }

    // Check if Cursor app is installed (macOS)
    const appPaths = [
      '/Applications/Cursor.app',
      path.join(home, 'Applications', 'Cursor.app'),
    ];
    for (const p of appPaths) {
      if (fs.existsSync(p)) {
        return {
          connected: true,
          account: account || null,
          output: 'Cursor app installed (enable CLI: Cmd+Shift+P → "Install cursor command")',
        };
      }
    }
    return { connected: false, account: null, error: 'Cursor not found' };
  }

  async getPlanInfo() {
    return { tier: 'unknown', raw: 'Cursor plan detection not yet implemented' };
  }

  async execute(task, project, options = {}) {
    const timeout = options.timeout || 10 * 60 * 1000;
    const prompt = `${task.title}${task.description ? '\n\n' + task.description : ''}`;

    log.info(`[Cursor] Executing task "${task.title}"`);

    // Cursor CLI agent mode — exact flags may vary
    return new Promise((resolve) => {
      let output = '';
      let stderr = '';

      const proc = spawn('cursor', ['--agent', '--prompt', prompt], {
        cwd: project.repo_path,
        timeout,
        env: { ...process.env },
      });

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ success: false, output, error: 'Execution timed out' });
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ success: false, output, error: stderr || `Exit code ${code}` });
          return;
        }
        resolve({ success: true, output });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: '', error: err.message });
      });
    });
  }
}

module.exports = CursorProvider;
