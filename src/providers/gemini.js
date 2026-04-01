const BaseProvider = require('./base');
const log = require('../utils/logger');

class GeminiProvider extends BaseProvider {
  constructor() {
    super('gemini', 'Google Gemini', null);
  }

  _getApiKey() {
    try {
      const { getDb } = require('../db');
      const row = getDb().prepare('SELECT api_key FROM providers WHERE id = ?').get('gemini');
      if (row?.api_key) return row.api_key;
    } catch { /* db not ready */ }
    return process.env.GEMINI_API_KEY || null;
  }

  async detect() {
    return !!this._getApiKey();
  }

  async getPlanInfo() {
    return { tier: 'free', raw: 'Free tier (generous limits)' };
  }

  async test() {
    const apiKey = this._getApiKey();
    if (!apiKey) {
      return { connected: false, account: null, error: 'No GEMINI_API_KEY configured' };
    }
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        return { connected: true, account: 'api-key', output: 'Gemini API connected' };
      }
      return { connected: false, account: null, error: `API returned ${res.status}` };
    } catch (e) {
      return { connected: false, account: null, error: e.message };
    }
  }

  /**
   * Execute a prompt-response task via Gemini API.
   * No file editing — suitable for chat, review, planning, decomposition.
   */
  async execute(task, project, options = {}) {
    const apiKey = this._getApiKey();
    if (!apiKey) {
      return { success: false, output: '', error: 'No GEMINI_API_KEY configured' };
    }

    const model = 'gemini-2.0-flash';
    const timeout = options.timeout || 120000;

    const prompt = this._buildPrompt(task, project);
    log.info(`[Gemini] Executing task "${task.title}" with ${model}`);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 4096 },
          }),
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (res.status === 429) {
        return { success: false, output: '', error: 'rate_limited', rateLimited: true };
      }

      if (!res.ok) {
        const body = await res.text();
        return { success: false, output: '', error: `Gemini API error ${res.status}: ${body.slice(0, 300)}` };
      }

      const data = await res.json();
      const output = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cost = this._estimateCost(data.usageMetadata);

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

  _estimateCost(usage) {
    if (!usage) return null;
    // Gemini 2.0 Flash: free tier is very generous, paid is cheap
    // ~$0.10/1M input, ~$0.40/1M output
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    return ((inputTokens * 0.1 + outputTokens * 0.4) / 1_000_000);
  }
}

module.exports = GeminiProvider;
