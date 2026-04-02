const { spawn, execSync } = require('child_process');
const BaseProvider = require('./base');
const log = require('../utils/logger');

class AntigravityProvider extends BaseProvider {
  constructor() {
    super('antigravity', 'Google Antigravity', 'agy');
  }

  async detect() {
    try {
      execSync('which agy', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async getPlanInfo() {
    return { tier: 'free', raw: 'Free for individuals' };
  }

  async test() {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.HOME || process.env.USERPROFILE || '';

    let account = null;

    // Try reading account from config/credentials files
    const configPaths = [
      path.join(home, '.antigravity', 'config.json'),
      path.join(home, '.antigravity', 'credentials.json'),
    ];
    for (const p of configPaths) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        account = data.email || data.account || null;
        if (account) break;
      } catch { /* skip */ }
    }

    // Try CLI to get email
    if (!account) {
      try {
        const out = execSync('agy config get email 2>&1', { encoding: 'utf-8', timeout: 5000 });
        const trimmed = out.trim();
        if (trimmed && trimmed.includes('@')) account = trimmed;
      } catch { /* not available */ }
    }

    try {
      // agy is the editor CLI — check it exists and responds to --version
      const output = execSync('agy --version 2>&1', {
        encoding: 'utf-8',
        timeout: 10000,
      });
      const connected = output.length > 0;
      return { connected, account: account || null, output: `Antigravity ${output.trim().slice(0, 100)}` };
    } catch (e) {
      // Also check if the app is installed even without CLI
      const appExists = fs.existsSync('/Applications/Antigravity.app') ||
        fs.existsSync(path.join(home, '.antigravity'));
      if (appExists) {
        return { connected: true, account: account || null, output: 'Antigravity app installed (CLI may need setup)' };
      }
      return { connected: false, account: null, error: 'Antigravity not found' };
    }
  }

  async execute(task, project, options = {}) {
    const timeout = options.timeout || 10 * 60 * 1000;
    const prompt = this._buildPrompt(task, project);

    log.info(`[Antigravity] Executing task "${task.title}"`);

    return new Promise((resolve) => {
      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn('agy', ['chat', '--mode', 'agent', prompt], {
        cwd: project.repo_path,
        timeout,
        env: { ...process.env },
      });

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ success: false, output, error: 'Execution timed out' });
          return;
        }
        const combined = output + stderr;
        if (combined.includes('rate limit') || combined.includes('429')) {
          resolve({ success: false, output, error: 'rate_limited', rateLimited: true });
          return;
        }
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

  _buildPrompt(task, project) {
    const parts = [task.title];
    if (task.description) parts.push(task.description);
    if (project.context) parts.push(`Project context: ${project.context}`);

    // Add project rules if available
    try {
      const fs = require('fs');
      const path = require('path');
      const claudeMd = fs.readFileSync(path.join(project.repo_path, 'CLAUDE.md'), 'utf-8');
      if (claudeMd) parts.push(`Project rules:\n${claudeMd.slice(0, 2000)}`);
    } catch {}

    return parts.join('\n\n');
  }
}

module.exports = AntigravityProvider;
