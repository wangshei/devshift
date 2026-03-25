const { spawn } = require('child_process');
const { execSync } = require('child_process');
const BaseProvider = require('./base');
const log = require('../utils/logger');

class ClaudeCodeProvider extends BaseProvider {
  constructor() {
    super('claude_code', 'Claude Code', 'claude');
  }

  async detect() {
    try {
      execSync('which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async getPlanInfo() {
    try {
      const output = execSync('claude /status 2>&1', {
        encoding: 'utf-8',
        timeout: 15000,
      });
      // Parse plan tier from status output
      const tierMatch = output.match(/(?:plan|tier|subscription)[:\s]*(pro|max\s*5x|max\s*20x|free)/i);
      return {
        tier: tierMatch ? tierMatch[1].toLowerCase() : 'unknown',
        raw: output.trim(),
      };
    } catch (e) {
      return { tier: 'unknown', error: e.message };
    }
  }

  async test() {
    const fs = require('fs');
    const path = require('path');
    const home = process.env.HOME || process.env.USERPROFILE || '';

    // Helper to extract account from auth status output
    function parseAccount(output) {
      // Look for patterns like "Logged in as: user@email.com" or "account: email"
      const patterns = [
        /logged in as[:\s]+([^\s]+@[^\s]+)/i,
        /account[:\s]+([^\s]+@[^\s]+)/i,
        /email[:\s]+([^\s]+@[^\s]+)/i,
        /([^\s]+@[^\s]+)/,
      ];
      for (const re of patterns) {
        const m = output.match(re);
        if (m) return m[1].trim();
      }
      return null;
    }

    // Check if claude is on PATH
    try {
      execSync('which claude', { stdio: 'ignore', timeout: 5000 });
    } catch {
      return { connected: false, account: null, error: 'claude not found on PATH' };
    }

    // Try claude auth status
    let account = null;
    let authOutput = '';
    try {
      authOutput = execSync('claude auth status 2>&1', { encoding: 'utf-8', timeout: 10000 });
      account = parseAccount(authOutput);
    } catch (e) {
      authOutput = e.message || '';
    }

    // If no account from CLI, try reading config files
    if (!account) {
      const configPaths = [
        path.join(home, '.claude', 'settings.json'),
        path.join(home, '.claude', '.credentials.json'),
      ];
      for (const p of configPaths) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
          account = data.email || data.account || null;
          if (account) break;
        } catch { /* skip */ }
      }
    }

    // If still no account, scan ~/.claude/ for any JSON auth file
    if (!account) {
      try {
        const claudeDir = path.join(home, '.claude');
        const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(claudeDir, f), 'utf-8'));
            account = data.email || data.account || null;
            if (account) break;
          } catch { /* skip */ }
        }
      } catch { /* dir not readable */ }
    }

    // Determine connected: claude is on PATH (already confirmed above)
    const connected = true;
    return { connected, account: account || null, output: authOutput.trim().slice(0, 500) };
  }

  /**
   * Execute a task using claude -p
   * @param {object} task
   * @param {object} project
   * @param {object} options - { model, timeout, logPath }
   */
  async execute(task, project, options = {}) {
    const fs = require('fs');
    const model = options.model || task.model || 'sonnet';
    const timeout = options.timeout || 10 * 60 * 1000; // 10 min default

    const prompt = this._buildPrompt(task, project);
    const args = ['-p', prompt, '--output-format', 'text', '--permission-mode', 'bypassPermissions'];
    if (model === 'opus') {
      args.push('--model', 'opus');
    }

    log.info(`[ClaudeCode] Executing task "${task.title}" with model ${model}`);

    return new Promise((resolve) => {
      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn('claude', args, {
        cwd: project.repo_path,
        timeout,
        env: { ...process.env },
      });

      if (options.logPath) {
        const logStream = fs.createWriteStream(options.logPath, { flags: 'a' });
        proc.stdout.on('data', (data) => { output += data.toString(); logStream.write(data); });
        proc.stdout.on('end', () => logStream.close());
      } else {
        proc.stdout.on('data', (data) => { output += data.toString(); });
      }
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

        // Check for rate limiting
        const combined = output + stderr;
        if (combined.includes('rate limit') || combined.includes('Rate limit') ||
            combined.includes('Too many requests') || combined.includes('429')) {
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
    let prompt = task.title;
    if (task.description) prompt += `\n\n${task.description}`;
    if (project.context) prompt += `\n\nProject context: ${project.context}`;
    if (project.preferences) {
      try {
        const prefs = JSON.parse(project.preferences);
        if (Array.isArray(prefs)) prompt += `\n\nProject rules:\n${prefs.join('\n')}`;
        else prompt += `\n\nProject rules: ${JSON.stringify(prefs)}`;
      } catch { /* ignore parse errors */ }
    }
    return prompt;
  }
}

module.exports = ClaudeCodeProvider;
