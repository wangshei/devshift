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

/**
 * Check if a task title is vague/short and needs improvement.
 */
function needsImprovement(title) {
  // Short tasks, texted tasks, or tasks without clear action verbs
  if (title.length < 30) return true;
  if (!/\b(add|fix|update|create|implement|remove|refactor|test|write|build|improve|change|move|rename)\b/i.test(title)) return true;
  return false;
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

  const prompt = `You are a senior developer planning work for a coding agent.

The user sent this task (possibly from their phone, so it may be brief):
"${task.title}"${task.description ? `\nExtra context: "${task.description}"` : ''}

Project: ${project.name}
${project.context ? `Context: ${project.context}` : ''}

Your job:
1. Expand this into a clear, detailed task description that a coding agent can execute
2. If this is a complex task, break it into 2-5 smaller subtasks
3. For each task/subtask, specify:
   - A clear title (imperative: "Add...", "Fix...", "Update...")
   - Detailed description with acceptance criteria
   - Whether it needs human review (design decisions, credentials) or can be auto-completed

Return JSON:
{
  "improved_title": "Clear, specific title",
  "improved_description": "Detailed description with acceptance criteria",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What to do",
      "task_type": "agent" or "human",
      "tier": 1 or 2 or 3
    }
  ]
}

If the task is simple enough to not need subtasks, return an empty subtasks array.
Return ONLY the JSON, no other text.`;

  try {
    // Use claude to improve the prompt
    const output = execSync(`claude -p ${JSON.stringify(prompt)} --output-format text`, {
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
      db.prepare("UPDATE tasks SET status = 'done', result_summary = ? WHERE id = ?")
        .run(`Decomposed into ${result.subtasks.length} subtasks`, taskId);

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
    if (needsImprovement(task.title)) {
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
