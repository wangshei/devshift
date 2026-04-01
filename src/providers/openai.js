const BaseProvider = require('./base');
const log = require('../utils/logger');

class OpenAIProvider extends BaseProvider {
  constructor() {
    super('openai', 'OpenAI GPT', null);
  }

  _getApiKey() {
    // Check DB first, then env var
    try {
      const { getDb } = require('../db');
      const row = getDb().prepare('SELECT api_key FROM providers WHERE id = ?').get('openai');
      if (row?.api_key) return row.api_key;
    } catch { /* db not ready */ }
    return process.env.OPENAI_API_KEY || null;
  }

  async detect() {
    return !!this._getApiKey();
  }

  async getPlanInfo() {
    return { tier: 'api', raw: 'Pay-per-use API' };
  }

  async test() {
    const apiKey = this._getApiKey();
    if (!apiKey) {
      return { connected: false, account: null, error: 'No OPENAI_API_KEY configured' };
    }
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        return { connected: true, account: 'api-key', output: 'OpenAI API connected' };
      }
      return { connected: false, account: null, error: `API returned ${res.status}` };
    } catch (e) {
      return { connected: false, account: null, error: e.message };
    }
  }

  /**
   * Execute a prompt-response task via OpenAI API.
   * No file editing — suitable for chat, review, planning, decomposition.
   */
  async execute(task, project, options = {}) {
    const apiKey = this._getApiKey();
    if (!apiKey) {
      return { success: false, output: '', error: 'No OPENAI_API_KEY configured' };
    }

    const tier = task.tier || 2;
    const model = tier === 1 ? 'gpt-4o-mini' : 'gpt-4o';
    const timeout = options.timeout || 120000;

    const prompt = this._buildPrompt(task, project);
    log.info(`[OpenAI] Executing task "${task.title}" with ${model}`);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a senior software engineer. Provide clear, actionable responses.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (res.status === 429) {
        return { success: false, output: '', error: 'rate_limited', rateLimited: true };
      }

      if (!res.ok) {
        const body = await res.text();
        return { success: false, output: '', error: `OpenAI API error ${res.status}: ${body.slice(0, 300)}` };
      }

      const data = await res.json();
      const output = data.choices?.[0]?.message?.content || '';
      const cost = this._estimateCost(data.usage, model);

      return { success: true, output, cost };
    } catch (e) {
      if (e.name === 'TimeoutError') {
        return { success: false, output: '', error: 'Execution timed out' };
      }
      return { success: false, output: '', error: e.message };
    }
  }

  _buildPrompt(task, project) {
    const parts = [task.title];
    if (task.description) parts.push(task.description);
    if (project.context) parts.push(`Project context: ${project.context}`);

    try {
      const fs = require('fs');
      const path = require('path');
      const claudeMd = fs.readFileSync(path.join(project.repo_path, 'CLAUDE.md'), 'utf-8');
      if (claudeMd) parts.push(`Project rules:\n${claudeMd.slice(0, 2000)}`);
    } catch { /* no CLAUDE.md */ }

    return parts.join('\n\n');
  }

  _estimateCost(usage, model) {
    if (!usage) return null;
    // Approximate pricing per 1M tokens (as of 2025)
    const rates = {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    };
    const rate = rates[model] || rates['gpt-4o'];
    return ((usage.prompt_tokens * rate.input + usage.completion_tokens * rate.output) / 1_000_000);
  }
}

module.exports = OpenAIProvider;
