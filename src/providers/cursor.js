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
    try {
      execSync('which cursor', { stdio: 'ignore', timeout: 5000 });
      return { connected: true, output: 'Cursor CLI found' };
    } catch {
      return { connected: false, error: 'Cursor CLI not found' };
    }
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
