const { v4: uuid } = require('uuid');
const { execSync } = require('child_process');
const { getDb } = require('../db');
const log = require('../utils/logger');

/**
 * Memory categories for project-level learnings
 */
const PROJECT_CATEGORIES = {
  PATTERNS: 'patterns',         // Code patterns, conventions, architecture decisions
  PITFALLS: 'pitfalls',         // Common errors, things that break, gotchas
  PREFERENCES: 'preferences',   // User preferences for this project (from comments/rejections)
  COMPLETED: 'completed',       // What's been done (prevents duplicate work)
  CONTEXT: 'context',           // Key project context (tech stack, deployment, etc.)
};

/**
 * Memory categories for system-level learnings
 */
const SYSTEM_CATEGORIES = {
  EXECUTION_PATTERNS: 'execution_patterns',   // What types of tasks succeed/fail
  PROMPT_LESSONS: 'prompt_lessons',           // What makes prompts effective
  REVIEW_FEEDBACK: 'review_feedback',         // Common reviewer findings
  USER_PREFERENCES: 'user_preferences',       // Cross-project user preferences
};

/**
 * Record a project-level memory.
 */
function addProjectMemory(projectId, category, content, sourceTaskId = null) {
  const db = getDb();

  // Check for duplicate/similar content (same category, similar text)
  const existing = db.prepare(
    'SELECT * FROM project_memory WHERE project_id = ? AND category = ? AND content LIKE ?'
  ).get(projectId, category, `%${content.slice(0, 50)}%`);

  if (existing) {
    // Update existing memory with richer content
    db.prepare('UPDATE project_memory SET content = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(content, existing.id);
    return existing.id;
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO project_memory (id, project_id, category, content, source_task_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, projectId, category, content, sourceTaskId);
  return id;
}

/**
 * Record a system-level memory.
 */
function addSystemMemory(category, content, sourceProjectId = null, sourceTaskId = null) {
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM system_memory WHERE category = ? AND content LIKE ?'
  ).get(category, `%${content.slice(0, 50)}%`);

  if (existing) {
    db.prepare('UPDATE system_memory SET content = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(content, existing.id);
    return existing.id;
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO system_memory (id, category, content, source_project_id, source_task_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, category, content, sourceProjectId, sourceTaskId);
  return id;
}

/**
 * Get all memories for a project — used in admin/settings views.
 * Renamed from getProjectMemories() to make the tiered API the default.
 */
function getAllProjectMemories(projectId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM project_memory WHERE project_id = ? ORDER BY category, updated_at DESC'
  ).all(projectId);
}

/**
 * Get WORKING memory for a project — recent, high-signal memories always loaded into prompts.
 * This stays small: only memories from last 48 hours + consolidated patterns.
 */
function getWorkingMemory(projectId) {
  const db = getDb();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Working tier: recent memories + all patterns (consolidated insights are always relevant)
  return db.prepare(`
    SELECT * FROM project_memory
    WHERE project_id = ? AND (
      memory_tier = 'working' AND updated_at > ?
      OR category = 'patterns'
      OR category = 'preferences'
    )
    ORDER BY category, updated_at DESC
  `).all(projectId, twoDaysAgo);
}

/**
 * Get LONG-TERM memory by keyword search — for specific context retrieval.
 * Only called when the agent needs to look something up.
 */
function searchMemory(projectId, query, limit = 10) {
  const db = getDb();
  // SQLite LIKE-based search (good enough for local use)
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  if (keywords.length === 0) return [];

  const conditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' AND ');
  const params = keywords.map(k => `%${k}%`);

  return db.prepare(`
    SELECT * FROM project_memory
    WHERE project_id = ? AND ${conditions}
    ORDER BY updated_at DESC LIMIT ?
  `).all(projectId, ...params, limit);
}

/**
 * Get working system memories — consolidated cross-project lessons.
 */
function getWorkingSystemMemory() {
  const db = getDb();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT * FROM system_memory
    WHERE memory_tier = 'working' AND updated_at > ?
       OR category = 'prompt_lessons'
       OR category = 'user_preferences'
    ORDER BY category, updated_at DESC
  `).all(twoDaysAgo);
}

/**
 * Get system memories (for injecting into PM/system prompts).
 */
function getSystemMemories() {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM system_memory ORDER BY category, updated_at DESC'
  ).all();
}

/**
 * Format memories into a prompt-injectable string.
 * Uses one-line summaries (max 120 chars) to keep prompts compact.
 */
function formatMemoriesForPrompt(memories, label = 'Learnings') {
  if (!memories || memories.length === 0) return '';

  const grouped = {};
  for (const m of memories) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  }

  let result = `\n## ${label}\n`;
  for (const [cat, items] of Object.entries(grouped)) {
    result += `\n### ${cat.replace(/_/g, ' ')}\n`;
    const limit = (cat === 'patterns' || cat === 'preferences') ? 5 : 3;
    for (const item of items.slice(0, limit)) {
      // One-line summary: first 120 chars, no newlines
      const oneLine = item.content.replace(/\n/g, ' ').slice(0, 120);
      result += `- ${oneLine}\n`;
    }
    if (items.length > limit) {
      result += `- (${items.length - limit} more — use @search to retrieve)\n`;
    }
  }
  return result;
}

/**
 * Learn from a completed task — extract lessons and store as memories.
 * Called after task execution completes (success or failure).
 */
function learnFromTask(taskId) {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) return;

  // 1. Record what was completed (prevent duplicate work)
  if (task.status === 'done' && task.tier !== 3) {
    addProjectMemory(
      task.project_id,
      PROJECT_CATEGORIES.COMPLETED,
      `Completed: ${task.title}${task.branch_name ? ` (branch: ${task.branch_name})` : ''}`,
      taskId
    );
  }

  // 2. Learn from failures
  if (task.status === 'failed') {
    const errorLog = task.execution_log || 'Unknown error';
    addProjectMemory(
      task.project_id,
      PROJECT_CATEGORIES.PITFALLS,
      `Task "${task.title}" failed: ${errorLog.slice(0, 300)}`,
      taskId
    );

    // System-level: track failure patterns
    addSystemMemory(
      SYSTEM_CATEGORIES.EXECUTION_PATTERNS,
      `Tier ${task.tier} task failed (${task.model}): "${task.title}" — ${errorLog.slice(0, 200)}`,
      task.project_id, taskId
    );
  }

  // 3. Learn from verification failures that needed retries
  if (task.review_instructions && task.review_instructions.includes('Verification failed')) {
    addProjectMemory(
      task.project_id,
      PROJECT_CATEGORIES.PITFALLS,
      `Task "${task.title}" needed retries. Verification issues: ${task.review_instructions.slice(0, 300)}`,
      taskId
    );

    addSystemMemory(
      SYSTEM_CATEGORIES.PROMPT_LESSONS,
      `Task needing retries: "${task.title}" (tier ${task.tier}). Lesson: verification caught issues that the agent missed on first pass.`,
      task.project_id, taskId
    );
  }

  // 4. Learn from user comments (feedback)
  const comments = db.prepare(
    "SELECT * FROM task_comments WHERE task_id = ? AND author = 'user' ORDER BY created_at ASC"
  ).all(taskId);

  for (const comment of comments) {
    addProjectMemory(
      task.project_id,
      PROJECT_CATEGORIES.PREFERENCES,
      `User feedback on "${task.title}": ${comment.content.slice(0, 300)}`,
      taskId
    );
  }

  // 5. Learn from rejections
  if (task.status === 'failed' && task.execution_log === 'Rejected by user') {
    addProjectMemory(
      task.project_id,
      PROJECT_CATEGORIES.PREFERENCES,
      `User rejected task "${task.title}". Check comments for reasons.`,
      taskId
    );

    addSystemMemory(
      SYSTEM_CATEGORIES.REVIEW_FEEDBACK,
      `Task rejected by user: "${task.title}" (tier ${task.tier}, ${task.model}). May indicate poor task decomposition or wrong approach.`,
      task.project_id, taskId
    );
  }

  log.debug(`[Memory] Processed learnings from task "${task.title}"`);
}

/**
 * Read memory limits from DB schedule row, falling back to defaults.
 */
function getLimits() {
  try {
    const db = getDb();
    const schedule = db.prepare('SELECT memory_per_category, memory_system_max FROM schedule WHERE id = 1').get();
    return {
      maxPerCategory: schedule?.memory_per_category || 20,
      maxSystem: schedule?.memory_system_max || 30,
    };
  } catch {
    return { maxPerCategory: 20, maxSystem: 30 };
  }
}

/**
 * Prune old memories to prevent unbounded growth.
 * Keeps at most maxPerCategory memories per category per project.
 * Keeps at most maxSystem memories per system category.
 * Removes "completed" memories older than 30 days (they're just for dedup).
 */
function pruneMemories() {
  const db = getDb();
  const { maxPerCategory, maxSystem } = getLimits();
  let pruned = 0;

  // 1. Prune per-project memories: keep only the newest maxPerCategory per category per project
  const projects = db.prepare('SELECT DISTINCT project_id FROM project_memory').all();
  const categories = Object.values(PROJECT_CATEGORIES);

  for (const { project_id } of projects) {
    for (const cat of categories) {
      const count = db.prepare(
        'SELECT COUNT(*) as c FROM project_memory WHERE project_id = ? AND category = ?'
      ).get(project_id, cat);

      if (count.c > maxPerCategory) {
        const excess = count.c - maxPerCategory;
        db.prepare(`
          DELETE FROM project_memory WHERE id IN (
            SELECT id FROM project_memory
            WHERE project_id = ? AND category = ?
            ORDER BY updated_at ASC LIMIT ?
          )
        `).run(project_id, cat, excess);
        pruned += excess;
      }
    }
  }

  // 2. Prune "completed" memories older than 30 days (just dedup markers)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const oldCompleted = db.prepare(
    "DELETE FROM project_memory WHERE category = 'completed' AND created_at < ?"
  ).run(thirtyDaysAgo);
  pruned += oldCompleted.changes;

  // 3. Prune system memories: keep only maxSystem per category
  const sysCats = Object.values(SYSTEM_CATEGORIES);
  for (const cat of sysCats) {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM system_memory WHERE category = ?'
    ).get(cat);

    if (count.c > maxSystem) {
      const excess = count.c - maxSystem;
      db.prepare(`
        DELETE FROM system_memory WHERE id IN (
          SELECT id FROM system_memory WHERE category = ?
          ORDER BY updated_at ASC LIMIT ?
        )
      `).run(cat, excess);
      pruned += excess;
    }
  }

  // 4. Truncate old execution output (keep only last 500 chars for executions older than 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE executions SET output = SUBSTR(output, -500)
    WHERE completed_at < ? AND LENGTH(output) > 500
  `).run(sevenDaysAgo);

  // 5. Archive old working memories to long-term (older than 48 hours, except patterns/preferences)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const archived = db.prepare(`
    UPDATE project_memory SET memory_tier = 'long_term'
    WHERE memory_tier = 'working'
      AND updated_at < ?
      AND category NOT IN ('patterns', 'preferences')
  `).run(twoDaysAgo);
  if (archived.changes > 0) {
    log.info(`[Memory] Archived ${archived.changes} memories to long-term`);
  }

  // Same for system memory
  db.prepare(`
    UPDATE system_memory SET memory_tier = 'long_term'
    WHERE memory_tier = 'working'
      AND updated_at < ?
      AND category NOT IN ('prompt_lessons', 'user_preferences')
  `).run(twoDaysAgo);

  if (pruned > 0) {
    log.info(`[Memory] Pruned ${pruned} old memories`);
  }

  return pruned;
}

/**
 * Periodic memory consolidation — analyze accumulated memories and produce insights.
 * Called less frequently (e.g., daily or when backlog is empty).
 */
async function consolidateMemories(projectId) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return;

  const pitfalls = db.prepare(
    "SELECT content FROM project_memory WHERE project_id = ? AND category = 'pitfalls' ORDER BY created_at DESC LIMIT 20"
  ).all(projectId);

  if (pitfalls.length < 3) return; // Not enough data to consolidate

  // Use Claude to synthesize lessons
  const prompt = `You are analyzing error patterns for the project "${project.name}".

Here are recent failures and issues:
${pitfalls.map((p, i) => `${i + 1}. ${p.content}`).join('\n')}

Synthesize these into 2-4 actionable lessons. Each lesson should be a single sentence that a coding agent can follow to avoid these problems in the future.

Return JSON only:
{ "lessons": ["lesson 1", "lesson 2"] }`;

  try {
    const output = execSync(
      `claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet`,
      { encoding: 'utf-8', timeout: 60000, cwd: project.repo_path }
    );

    const match = output.match(/\{[\s\S]*\}/);
    if (match) {
      const { lessons } = JSON.parse(match[0]);
      for (const lesson of (lessons || [])) {
        addProjectMemory(projectId, PROJECT_CATEGORIES.PATTERNS, lesson);
      }
      log.info(`[Memory] Consolidated ${lessons?.length || 0} lessons for "${project.name}"`);
    }
  } catch (e) {
    log.warn(`[Memory] Consolidation failed: ${e.message}`);
  }
}

module.exports = {
  addProjectMemory, addSystemMemory,
  getWorkingMemory, getWorkingSystemMemory, searchMemory,
  getAllProjectMemories, getSystemMemories,
  formatMemoriesForPrompt,
  learnFromTask, consolidateMemories,
  pruneMemories,
  PROJECT_CATEGORIES, SYSTEM_CATEGORIES,
};
