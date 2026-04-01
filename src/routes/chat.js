const { Router } = require('express');
const { spawn } = require('child_process');
const { getDb } = require('../db');
const log = require('../utils/logger');

const router = Router();

// Active chat processes (sessionId → process info)
const activeSessions = new Map();

/**
 * POST /api/chat/send — send a message and stream the response via SSE
 *
 * Body: { taskId, message, model? }
 *
 * If the task has a session_id, resumes that session.
 * If not, starts a new session with task context.
 *
 * Response: Server-Sent Events stream
 */
router.post('/send', (req, res) => {
  const db = getDb();
  const { taskId, message, model } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message required' });
  }

  let task = null;
  let project = null;
  let sessionId = null;

  if (taskId) {
    task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (task) {
      project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
      sessionId = task.session_id;
    }
  }

  let enrichedMessage = message.trim();

  // First message in session — add project context so Claude already knows the project
  if (!sessionId && project) {
    let context = `[Project: ${project.name} at ${project.repo_path}]`;

    // Add brief memory context
    try {
      const { getWorkingMemory, formatMemoriesForPrompt } = require('../services/memory');
      const memories = getWorkingMemory(project.id);
      if (memories.length > 0) {
        context += formatMemoriesForPrompt(memories, 'What you should know');
      }
    } catch {}

    enrichedMessage = context + '\n\n' + enrichedMessage;
  }

  // Build the claude command
  const args = ['-p', enrichedMessage, '--output-format', 'stream-json', '--verbose'];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // Use bypassPermissions so Claude can read/edit files
  args.push('--permission-mode', 'bypassPermissions');

  const selectedModel = model || 'sonnet';
  if (selectedModel === 'opus') {
    args.push('--model', 'opus');
  } else {
    args.push('--model', 'sonnet');
  }

  const cwd = project?.repo_path || process.cwd();

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  log.debug(`[Chat] Sending message${sessionId ? ' (resuming ' + sessionId.slice(0, 8) + ')' : ' (new session)'}`);

  const proc = spawn('claude', args, {
    cwd,
    env: { ...process.env },
    timeout: 5 * 60 * 1000, // 5 min timeout for chat
  });

  let fullOutput = '';
  let newSessionId = null;
  let cost = null;

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    fullOutput += text;

    // Parse each line as JSON and forward relevant events
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // Capture session_id from any event
        if (event.session_id) newSessionId = event.session_id;

        if (event.type === 'assistant') {
          // Stream assistant text content
          const textContent = event.message?.content?.find(c => c.type === 'text');
          if (textContent?.text) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: textContent.text })}\n\n`);
          }

          // Stream tool use events
          const toolUse = event.message?.content?.find(c => c.type === 'tool_use');
          if (toolUse) {
            res.write(`data: ${JSON.stringify({ type: 'tool_use', tool: toolUse.name, input: JSON.stringify(toolUse.input).slice(0, 200) })}\n\n`);
          }
        } else if (event.type === 'result') {
          // Final result
          newSessionId = event.session_id;
          cost = event.total_cost_usd;
          res.write(`data: ${JSON.stringify({ type: 'done', sessionId: event.session_id, cost: event.total_cost_usd, result: event.result })}\n\n`);
        }
      } catch {
        // Not valid JSON line, skip
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    // Forward errors
    const text = chunk.toString().trim();
    if (text) {
      res.write(`data: ${JSON.stringify({ type: 'status', content: text.slice(0, 200) })}\n\n`);
    }
  });

  proc.on('close', (code) => {
    // Save session_id to task if we have one
    if (newSessionId && taskId) {
      try {
        db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(newSessionId, taskId);
      } catch {}
    }

    res.write(`data: ${JSON.stringify({ type: 'close', code, sessionId: newSessionId })}\n\n`);
    res.end();
  });

  proc.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });
});

/**
 * POST /api/chat/start — start a new chat session for a task (or freeform)
 * Returns the initial context message.
 */
router.post('/start', (req, res) => {
  const db = getDb();
  const { taskId, projectId } = req.body;

  let context = {};

  if (taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (task) {
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
      context = {
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description,
        projectId: task.project_id,
        projectName: project?.name,
        repoPath: project?.repo_path,
        sessionId: task.session_id,
        branchName: task.branch_name,
      };
    }
  } else if (projectId) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (project) {
      context = {
        projectId: project.id,
        projectName: project.name,
        repoPath: project.repo_path,
      };
    }
  }

  res.json(context);
});

/**
 * POST /api/chat/push-to-agent — hand off the chat session to the agent
 */
router.post('/push-to-agent', (req, res) => {
  const db = getDb();
  const { taskId, sessionId, note } = req.body;

  if (!taskId) return res.status(400).json({ error: 'taskId required' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Update task with session and queue for agent
  const handoffNote = note ? `\n\n---\n**Handoff from chat:** ${note}` : '';

  db.prepare(`
    UPDATE tasks SET status = 'queued', worker = 'agent',
      session_id = COALESCE(?, session_id),
      description = COALESCE(description, '') || ?
    WHERE id = ?
  `).run(sessionId || null, handoffNote, taskId);

  // Store in memory
  try {
    const { addProjectMemory, PROJECT_CATEGORIES } = require('../services/memory');
    addProjectMemory(task.project_id, PROJECT_CATEGORIES.CONTEXT,
      `User chatted about "${task.title}" then pushed to agent${note ? ': ' + note : ''}`, taskId);
  } catch {}

  res.json({ pushed: true });
});

module.exports = router;
