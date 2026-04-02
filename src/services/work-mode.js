const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { execSync } = require('child_process');
const { getDb } = require('../db');
const { classify } = require('./classifier');
const log = require('../utils/logger');

/**
 * Work Mode — smart task processing.
 *
 * When a task comes in (especially vague/texted ones), Work Mode:
 * 1. Improves the prompt (expand vague text into clear instructions)
 * 2. Decomposes into subtasks if complex
 * 3. Routes each subtask to the right project + provider
 * 4. Queues for execution
 */

/** Vague words that need more specifics to be actionable */
const VAGUE_WORDS = /\b(fix|update|change|improve|handle|address|tweak|adjust|do|make)\b/i;

/** Pattern to detect file path references */
const FILE_PATH_PATTERN = /(?:^|\s|\/)([\w.-]+\/[\w.-]+(?:\.[\w]+)?)/;

/**
 * Check if a task title/description is vague and needs improvement.
 * @param {string} title
 * @param {string} [description]
 * @param {{ tier?: number, parent_task_id?: string|null, subtaskCount?: number }} [meta]
 * @returns {boolean}
 */
function needsImprovement(title, description, meta) {
  // Never re-decompose tasks that already have subtasks
  if (meta && meta.subtaskCount && meta.subtaskCount > 0) return false;

  // Never decompose subtasks (they came from a prior decomposition)
  if (meta && meta.parent_task_id) return false;

  // Tier 1 and 3 tasks don't need decomposition — they're focused
  if (meta && (meta.tier === 1 || meta.tier === 3)) return false;

  // If description exists and is meaningful (>100 chars), the task is specific enough
  if (description && description.length > 100) return false;

  // Only decompose truly vague tasks: short title + no description
  if (title.length < 20 && (!description || description.length < 30)) return true;

  // No action verb AND no description — too vague
  if (!/\b(add|fix|update|create|implement|remove|refactor|test|write|build|improve|change|move|rename|migrate|extract|replace|delete|configure|set up|integrate)\b/i.test(title) && (!description || description.length < 50)) return true;

  return false;
}

/**
 * Gather project context for the PM expansion prompt.
 * @param {{ repo_path: string }} project
 * @returns {{ claudeMd: string, directoryTree: string, packageScripts: Record<string, string> }}
 */
function gatherProjectContext(project) {
  const result = { claudeMd: '', directoryTree: '', packageScripts: {} };

  try {
    result.claudeMd = fs.readFileSync(path.join(project.repo_path, 'CLAUDE.md'), 'utf-8');
  } catch { /* no CLAUDE.md */ }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(project.repo_path, 'package.json'), 'utf-8'));
    result.packageScripts = pkg.scripts || {};
  } catch { /* no package.json */ }

  try {
    result.directoryTree = execSync(
      "find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' | head -80",
      { cwd: project.repo_path, encoding: 'utf-8', timeout: 5000 }
    ).trim();
  } catch { /* fallback */ }

  return result;
}

/**
 * Check if the Claude Code provider is enabled in the database.
 */
function isClaudeAvailable() {
  try {
    const db = getDb();
    const provider = db.prepare("SELECT * FROM providers WHERE id = 'claude_code' AND enabled = 1").get();
    return !!provider;
  } catch { return true; } // Default to available if DB check fails
}

/**
 * Use a coding agent to expand a vague task into a clear, actionable prompt.
 */
async function improvePrompt(taskId) {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error('Task not found');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project) throw new Error('Project not found');

  log.info(`[WorkMode] Improving prompt for: "${task.title}"`);

  const ctx = gatherProjectContext(project);

  // Load project memories for PM context
  let memoryContext = '';
  try {
    const { getWorkingMemory, getWorkingSystemMemory, formatMemoriesForPrompt } = require('./memory');
    const projMem = getWorkingMemory(project.id);
    const sysMem = getWorkingSystemMemory();
    memoryContext = formatMemoriesForPrompt(projMem, 'Project Learnings') +
                    formatMemoriesForPrompt(sysMem.slice(0, 10), 'System-wide Lessons');
  } catch { /* memory not available */ }

  const prompt = `You are a senior engineering PM decomposing a task for an AI coding agent.

## Task to decompose
Title: ${task.title}
Description: ${task.description || 'None'}

## Project: ${project.name}
Path: ${project.repo_path}

## Project Rules
${ctx.claudeMd || 'None'}

## Directory Structure
${ctx.directoryTree || 'Not available'}

## Available Scripts
${JSON.stringify(ctx.packageScripts)}
${memoryContext}

## Instructions
Break this task into 2-5 focused, actionable subtasks. Each subtask will be executed independently by an AI coding agent that has full access to the codebase.

For each subtask, provide:
- A clear, specific title that includes the target file(s) or component(s)
- A detailed description with:
  - What to change and where (specific file paths)
  - Acceptance criteria (what "done" looks like)
  - How to verify (which test/build command to run)
- task_type: "agent" (AI does it) or "human" (needs human judgment)
- tier: 1 (quick wins: tests, lint, docs, refactoring), 2 (features needing review), or 3 (research/analysis)

Return JSON only:
{
  "improved_title": "clearer version of the original title",
  "improved_description": "expanded description with context",
  "subtasks": [
    {
      "title": "specific title mentioning files/components",
      "description": "## What to change\\n...\\n\\n## Files to modify\\n- path/to/file.js\\n\\n## Acceptance criteria\\n- [ ] ...\\n\\n## Verification\\nRun \`npm test\` to confirm",
      "task_type": "agent",
      "tier": 1
    }
  ]
}

If the task is simple enough to not need subtasks, return an empty subtasks array.
Return ONLY the JSON, no other text.`;

  if (!isClaudeAvailable()) {
    log.warn('[WorkMode] Claude Code provider is disabled — skipping prompt improvement');
    return { improved: false, taskId, error: 'Claude Code provider is disabled' };
  }

  try {
    // Use claude to improve the prompt
    const output = execSync(`claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet --effort low`, {
      cwd: project.repo_path,
      encoding: 'utf-8',
      timeout: 60000,
    });

    const result = parseImprovement(output);
    if (!result) {
      log.warn('[WorkMode] Could not parse improvement output');
      return { improved: false, taskId };
    }

    // Update the original task with improved prompt
    if (result.improved_title) {
      db.prepare('UPDATE tasks SET title = ?, description = ? WHERE id = ?')
        .run(result.improved_title, result.improved_description || task.description, taskId);
    }

    // Create subtasks if any
    if (result.subtasks && result.subtasks.length > 0) {
      for (const sub of result.subtasks) {
        const subId = uuid();
        const classification = classify(sub.title, sub.description);
        db.prepare(`
          INSERT INTO tasks (id, project_id, title, description, task_type, tier, model, parent_task_id)
          VALUES (?, ?, ?, ?, ?, ?, 'sonnet', ?)
        `).run(subId, task.project_id,
          sub.title, sub.description || null,
          sub.task_type || classification.task_type,
          sub.tier ?? classification.tier,
          taskId);
      }

      // Mark original as a parent/container
      const hasTier2Subtasks = result.subtasks.some(s => (s.tier ?? 2) >= 2);
      if (hasTier2Subtasks) {
        db.prepare("UPDATE tasks SET status = 'needs_review', plan_status = 'pending_review', result_summary = ? WHERE id = ?")
          .run(`Plan: ${result.subtasks.length} subtasks awaiting approval`, taskId);
        // Keep subtasks in backlog until parent plan is approved
      } else {
        db.prepare("UPDATE tasks SET status = 'done', plan_status = 'auto', result_summary = ? WHERE id = ?")
          .run(`Decomposed into ${result.subtasks.length} subtasks`, taskId);
      }

      log.info(`[WorkMode] Decomposed "${task.title}" into ${result.subtasks.length} subtasks`);
    }

    return {
      improved: true,
      taskId,
      newTitle: result.improved_title,
      subtaskCount: result.subtasks?.length || 0,
    };
  } catch (e) {
    log.error(`[WorkMode] Prompt improvement failed: ${e.message}`);
    return { improved: false, taskId, error: e.message };
  }
}

/**
 * Parse the AI's improvement output.
 */
function parseImprovement(output) {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* not valid JSON */ }
  return null;
}

/**
 * Process all backlog tasks that need improvement.
 * Called by the scheduler before executing tasks.
 */
async function processBacklog() {
  const db = getDb();

  // Find vague/short tasks in backlog that haven't been processed
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('backlog', 'queued')
      AND task_type = 'agent'
      AND parent_task_id IS NULL
    ORDER BY priority ASC, created_at ASC
  `).all();

  let improved = 0;
  for (const task of tasks) {
    // Count existing subtasks for this task
    const subtaskCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM tasks WHERE parent_task_id = ?'
    ).get(task.id)?.cnt || 0;

    const meta = {
      tier: task.tier,
      parent_task_id: task.parent_task_id,
      subtaskCount,
    };

    if (needsImprovement(task.title, task.description, meta)) {
      try {
        const result = await improvePrompt(task.id);
        if (result.improved) improved++;
      } catch (e) {
        log.warn(`[WorkMode] Failed to improve task ${task.id}: ${e.message}`);
      }
      // Only improve one per cycle to conserve credits
      break;
    }
  }

  return improved;
}

module.exports = { improvePrompt, processBacklog, needsImprovement };
