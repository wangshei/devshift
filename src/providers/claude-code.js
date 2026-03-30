const { spawn } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const BaseProvider = require('./base');
const log = require('../utils/logger');

/**
 * Gather rich context from the project to build a high-quality prompt.
 * @param {object} project - { repo_path, name, ... }
 * @param {object} task - { title, description, tier, ... }
 * @returns {{ claudeMd: string, packageScripts: object|null, directoryTree: string, recentGitLog: string, referencedFileContents: string }}
 */
function gatherContext(project, task) {
  const repoPath = project.repo_path;

  // 1. Read CLAUDE.md if it exists
  let claudeMd = '';
  try {
    claudeMd = fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf-8').trim();
  } catch { /* missing is fine */ }

  // 2. Read package.json scripts
  let packageScripts = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf-8'));
    packageScripts = pkg.scripts || null;
  } catch { /* missing is fine */ }

  // 3. Directory tree overview
  let directoryTree = '';
  try {
    directoryTree = execSync(
      "find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -80",
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
    ).trim();
  } catch { /* ignore errors */ }

  // 4. Recent git log
  let recentGitLog = '';
  try {
    recentGitLog = execSync('git log --oneline -5', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
  } catch { /* not a git repo or no commits */ }

  // 5. Read referenced files from task description
  let referencedFileContents = '';
  if (task.description) {
    // Match file paths like src/foo/bar.js, lib/utils.ts, etc.
    const filePathRegex = /(?:^|\s|`)((?:[\w.-]+\/)+[\w.-]+\.\w+)/g;
    const seen = new Set();
    let match;
    while ((match = filePathRegex.exec(task.description)) !== null) {
      const filePath = match[1];
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        const fullPath = path.join(repoPath, filePath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n').slice(0, 100).join('\n');
        referencedFileContents += `\n### ${filePath}\n\`\`\`\n${lines}\n\`\`\`\n`;
      } catch { /* file doesn't exist, skip */ }
    }
  }

  // 6. Load project memories (learnings from past tasks)
  let projectMemories = '';
  try {
    const { getProjectMemories, formatMemoriesForPrompt } = require('../services/memory');
    const memories = getProjectMemories(project.id);
    projectMemories = formatMemoriesForPrompt(memories, 'Project Learnings');
  } catch { /* memory service not available */ }

  return { claudeMd, packageScripts, directoryTree, recentGitLog, referencedFileContents, projectMemories };
}

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
   * @param {object} options - { model, timeout, logPath, sessionId }
   */
  async execute(task, project, options = {}) {
    const tier = task.tier || 2;

    // Model selection based on tier
    let model;
    if (tier === 1) {
      model = 'sonnet';
    } else if (tier === 2) {
      model = (options.model || task.model) === 'opus' ? 'opus' : 'sonnet';
    } else {
      model = 'sonnet';
    }

    // Timeout based on tier
    const tierTimeouts = { 1: 5 * 60 * 1000, 2: 15 * 60 * 1000, 3: 10 * 60 * 1000 };
    const timeout = options.timeout || tierTimeouts[tier] || 15 * 60 * 1000;

    // Gather rich context
    const ctx = gatherContext(project, task);

    const prompt = this._buildPrompt(task, project, ctx);
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions'];
    if (model === 'opus') {
      args.push('--model', 'opus');
    }
    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    }

    log.info(`[ClaudeCode] Executing task "${task.title}" (tier ${tier}) with model ${model}, timeout ${Math.round(timeout / 60000)}m${options.sessionId ? `, resuming session ${options.sessionId}` : ''}`);

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
        proc.stderr.on('data', (data) => { stderr += data.toString(); logStream.write(data); });
        proc.stdout.on('end', () => logStream.close());
      } else {
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
      }

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

        // Parse JSON response to extract session_id and clean output
        let parsedResult = output;
        let sessionId = null;
        let cost = null;
        try {
          const json = JSON.parse(output);
          parsedResult = json.result || output;
          sessionId = json.session_id || null;
          cost = json.total_cost_usd || null;
        } catch {
          // Not JSON — use raw output (happens with older CLI versions)
        }

        resolve({ success: true, output: parsedResult, sessionId, cost });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: '', error: err.message });
      });
    });
  }

  /**
   * Build a rich, structured prompt with full project context.
   * @param {object} task
   * @param {object} project
   * @param {object} ctx - gathered context from gatherContext()
   * @returns {string}
   */
  _buildPrompt(task, project, ctx) {
    const scripts = ctx.packageScripts;
    const testCmd = scripts && (scripts.test || scripts['test:unit'] || scripts['test:all']);
    const buildCmd = scripts && (scripts.build || scripts['build:prod']);
    const lintCmd = scripts && (scripts.lint || scripts['lint:fix']);

    const verifySteps = [
      testCmd ? `- Run \`${testCmd.includes(' ') ? 'npm test' : `npm run ${Object.keys(scripts).find(k => scripts[k] === testCmd)}`}\` to check tests pass.` : '',
      buildCmd ? `- Run \`${buildCmd.includes(' ') ? 'npm run build' : `npm run ${Object.keys(scripts).find(k => scripts[k] === buildCmd)}`}\` to check the build succeeds.` : '',
      lintCmd ? `- Run \`${lintCmd.includes(' ') ? 'npm run lint' : `npm run ${Object.keys(scripts).find(k => scripts[k] === lintCmd)}`}\` to check for lint errors.` : '',
    ].filter(Boolean).join('\n  ');

    const parts = [
      `You are working on the project "${project.name}" at ${project.repo_path}.`,
      '',
      '## Task',
      task.title,
      '',
      '## Description',
      task.description || 'No additional description.',
    ];

    if (ctx.claudeMd) {
      parts.push('', '## Project Rules (CLAUDE.md)', ctx.claudeMd);
    } else {
      parts.push('', '## Project Rules (CLAUDE.md)', 'No CLAUDE.md found.');
    }

    parts.push(
      '',
      '## Available Scripts',
      scripts ? JSON.stringify(scripts, null, 2) : 'No package.json found.',
    );

    if (ctx.directoryTree) {
      parts.push('', '## Directory Structure', ctx.directoryTree);
    }

    if (ctx.recentGitLog) {
      parts.push('', '## Recent Changes', ctx.recentGitLog);
    }

    if (ctx.referencedFileContents) {
      parts.push('', '## Referenced Files', ctx.referencedFileContents);
    }

    if (ctx.projectMemories) {
      parts.push(ctx.projectMemories);
    }

    // Load task comments for additional context
    try {
      const { getDb } = require('../db');
      const comments = getDb().prepare(
        "SELECT content, author, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
      ).all(task.id);
      if (comments.length > 0) {
        parts.push('', '## User Feedback on This Task');
        for (const c of comments) {
          parts.push(`- [${c.author}]: ${c.content}`);
        }
      }
    } catch { /* no comments table yet */ }

    parts.push(
      '',
      '## Instructions',
      '- Read relevant files before making changes — understand the codebase first.',
      '- Follow existing code patterns and conventions.',
      '- After making changes, verify your work:',
    );
    if (verifySteps) {
      parts.push(`  ${verifySteps}`);
    }
    parts.push(
      '- If tests or build fail, fix the issues before finishing.',
      '- Do not add unnecessary comments, type annotations, or refactoring beyond what was asked.',
      '- Keep changes minimal and focused on the task.',
    );

    return parts.join('\n');
  }
}

module.exports = ClaudeCodeProvider;
