/**
 * Task classifier — determines task_type (agent/human) and tier (1/2/3).
 *
 * Tier 1: Quick autonomous wins (tests, docs, lint, formatting, deps, boilerplate)
 * Tier 2: Feature work that needs human review
 * Tier 3: Research tasks that produce written summaries
 *
 * task_type: 'agent' (AI handles), 'human' (surfaced to user), 'blocked' (waiting on something)
 */

const TIER1_PATTERNS = [
  /\b(test|spec|tests)\b/i,
  /\b(lint|eslint|format|prettier|formatting)\b/i,
  /\b(doc|docs|documentation|readme|jsdoc)\b/i,
  /\b(import|imports|cleanup|clean.?up)\b/i,
  /\b(error.?handling|try.?catch)\b/i,
  /\b(dependency|dependencies|upgrade|update|bump)\b/i,
  /\b(scaffold|boilerplate|ci|ci.?cd|config)\b/i,
  /\b(refactor|rename|move)\b/i,
  /\b(security.?audit|vulnerability|vulnerabilities)\b/i,
  /\b(type.?check|types|typescript)\b/i,
];

const TIER3_PATTERNS = [
  /\b(research|investigate|compare|evaluate|analyze|analysis)\b/i,
  /\b(proposal|recommend|suggestion|options|alternatives)\b/i,
  /\b(summary|summarize|report)\b/i,
];

const HUMAN_PATTERNS = [
  /\b(design.?decision|decide|choose|pick|select)\b/i,
  /\b(credential|api.?key|secret|token|password)\b/i,
  /\b(account|signup|register|login)\b/i,
  /\b(debug|debugging|investigate.?bug)\b/i,
  /\b(review|approve|merge)\b/i,
  /\b(brand|naming|name|logo|creative)\b/i,
  /\b(architecture|architect|tradeoff)\b/i,
];

/**
 * @param {string} title
 * @param {string} [description]
 * @returns {{ task_type: string, tier: number, model: string }}
 */
function classify(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();

  // Check for human-required patterns first
  for (const pattern of HUMAN_PATTERNS) {
    if (pattern.test(text)) {
      return { task_type: 'human', tier: 2, model: 'sonnet' };
    }
  }

  // Check for Tier 1 (quick autonomous wins)
  for (const pattern of TIER1_PATTERNS) {
    if (pattern.test(text)) {
      return { task_type: 'agent', tier: 1, model: 'sonnet' };
    }
  }

  // Check for Tier 3 (research)
  for (const pattern of TIER3_PATTERNS) {
    if (pattern.test(text)) {
      return { task_type: 'agent', tier: 3, model: 'sonnet' };
    }
  }

  // Default: Tier 2 agent work (feature work, needs review)
  return { task_type: 'agent', tier: 2, model: 'sonnet' };
}

module.exports = { classify };
