const { Router } = require('express');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db');

const router = Router();

// GET /api/comments/:taskId/comments
router.get('/:taskId/comments', (req, res) => {
  const db = getDb();
  const comments = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(req.params.taskId);
  res.json(comments);
});

// POST /api/comments/:taskId/comments
router.post('/:taskId/comments', (req, res) => {
  const db = getDb();
  const { content, author, image } = req.body;
  if (!content?.trim() && !image) return res.status(400).json({ error: 'Content or image required' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Save image to disk if provided
  let imageUrl = null;
  if (image && image.startsWith('data:image/')) {
    const fs = require('fs');
    const path = require('path');
    const { DATA_DIR } = require('../utils/config');
    const imageId = uuid();
    const ext = image.match(/data:image\/(\w+);/)?.[1] || 'png';
    const filename = `comment-${imageId}.${ext}`;
    const filepath = path.join(DATA_DIR, 'images', filename);
    fs.mkdirSync(path.join(DATA_DIR, 'images'), { recursive: true });
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, base64Data, 'base64');
    imageUrl = `/api/images/${filename}`;
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO task_comments (id, task_id, author, content, image_url) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.params.taskId, author || 'user', (content || '').trim(), imageUrl);

  const comment = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
  res.status(201).json(comment);

  // Auto-trigger agent reply for review/failed tasks when user posts a comment
  if (task && ['needs_review', 'failed'].includes(task.status) && (author || 'user') === 'user') {
    // Fire and forget — don't block the comment response
    setImmediate(async () => {
      try {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
        const comments = db.prepare(
          'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
        ).all(req.params.taskId);

        const provider = db.prepare("SELECT * FROM providers WHERE id = 'claude_code' AND enabled = 1").get();
        if (!provider) return;

        const prompt = `You are responding to user feedback on a task.

Task: ${task.title}
Status: ${task.status}
${task.result_summary ? 'Result: ' + task.result_summary.slice(0, 300) : ''}

Feedback:
${comments.slice(-3).map(c => `[${c.author}]: ${c.content}`).join('\n')}

Respond briefly (under 100 words). If there's an actionable fix, say what needs to change.`;

        const { execSync } = require('child_process');
        const output = execSync(
          `claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet --effort low`,
          { cwd: project?.repo_path || process.cwd(), encoding: 'utf-8', timeout: 30000 }
        );

        const replyId = require('uuid').v4();
        db.prepare('INSERT INTO task_comments (id, task_id, author, content) VALUES (?, ?, ?, ?)')
          .run(replyId, req.params.taskId, 'agent', output.trim());
      } catch (e) {
        const log = require('../utils/logger');
        log.warn('[Comments] Auto-reply failed: ' + e.message);
      }
    });
  }
});

// POST /api/comments/:taskId/agent-reply — get agent's response to recent comments
router.post('/:taskId/agent-reply', async (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const comments = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(req.params.taskId);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);

  const prompt = `You are reviewing feedback on a task.

Task: ${task.title}
${task.description ? 'Description: ' + task.description.slice(0, 500) : ''}
Status: ${task.status}
${task.result_summary ? 'Result: ' + task.result_summary.slice(0, 500) : ''}

Recent feedback:
${comments.slice(-5).map(c => `[${c.author}]: ${c.content}`).join('\n')}

Respond briefly to the feedback. If there's an actionable fix, say exactly what needs to change. If the feedback is about a bug or issue, explain what likely caused it and whether it can be auto-fixed.
Keep your response under 200 words.`;

  try {
    const { execSync } = require('child_process');

    // Check provider
    const provider = db.prepare("SELECT * FROM providers WHERE id = 'claude_code' AND enabled = 1").get();
    if (!provider) return res.status(400).json({ error: 'Claude not available' });

    const output = execSync(
      `claude -p ${JSON.stringify(prompt)} --output-format text --model sonnet --effort low`,
      { cwd: project?.repo_path || process.cwd(), encoding: 'utf-8', timeout: 30000 }
    );

    // Save as agent comment
    const replyId = uuid();
    db.prepare(
      'INSERT INTO task_comments (id, task_id, author, content) VALUES (?, ?, ?, ?)'
    ).run(replyId, req.params.taskId, 'agent', output.trim());

    // Check if agent suggests an auto-fix — if yes, create a task
    const suggestsFix = /\b(fix|change|update|replace|remove|add)\b.*\b(should|need|must|can)\b/i.test(output);
    let fixTaskId = null;
    if (suggestsFix && task.project_id) {
      fixTaskId = uuid();
      db.prepare(`
        INSERT INTO tasks (id, project_id, title, description, tier, task_type, status)
        VALUES (?, ?, ?, ?, 1, 'agent', 'queued')
      `).run(fixTaskId, task.project_id, `Fix: ${task.title} (from feedback)`, output.trim());
    }

    res.json({ replied: true, fixTaskCreated: !!fixTaskId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
