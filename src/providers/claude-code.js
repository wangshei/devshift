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

  /**
   * Execute a task using claude -p
   * @param {object} task
   * @param {object} project
   * @param {object} options - { model, timeout }
   */
  async execute(task, project, options = {}) {
    const model = options.model || task.model || 'sonnet';
    const timeout = options.timeout || 10 * 60 * 1000; // 10 min default

    const prompt = this._buildPrompt(task, project);
    const args = ['-p', prompt, '--output-format', 'text'];
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
