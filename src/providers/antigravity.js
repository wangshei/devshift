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

  async execute(task, project, options = {}) {
    const timeout = options.timeout || 10 * 60 * 1000;
    const prompt = this._buildPrompt(task, project);

    log.info(`[Antigravity] Executing task "${task.title}"`);

    return new Promise((resolve) => {
      let output = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn('agy', ['--headless', prompt], {
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
    let prompt = task.title;
    if (task.description) prompt += `\n\n${task.description}`;
    if (project.context) prompt += `\n\nProject context: ${project.context}`;
    return prompt;
  }
}

module.exports = AntigravityProvider;
