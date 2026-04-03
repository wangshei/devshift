const { Router } = require('express');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const log = require('../utils/logger');

const router = Router();

// Active chat processes (sessionId → process info)
const activeSessions = new Map();

// GET /api/chat/sessions — list all sessions
router.get('/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*, p.name as project_name,
      (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM chat_sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    ORDER BY s.updated_at DESC
  `).all();
  res.json(sessions);
});

// POST /api/chat/sessions — create a new session
router.post('/sessions', (req, res) => {
  const db = getDb();
  const { project_id, task_id, title, mode, model } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO chat_sessions (id, project_id, task_id, title, mode, model) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, project_id || null, task_id || null, title || 'New chat', mode || 'think', model || 'sonnet');
  res.status(201).json(db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id));
});

// DELETE /api/chat/sessions/:id
router.delete('/sessions/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(req.params.id);
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// GET /api/chat/sessions/:id/messages — get message history
router.get('/sessions/:id/messages', (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(messages);
});

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
  const { taskId, message, model, mode, projectId: bodyProjectId, sessionId: dbSessionId } = req.body;

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

  // If no task but projectId provided, load project directly
  if (!project && bodyProjectId) {
    project = db.prepare('SELECT * FROM projects WHERE id = ?').get(bodyProjectId);
  }

  // Load DB session (our persistent session, not Claude's session)
  let dbSession = null;
  if (dbSessionId) {
    dbSession = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(dbSessionId);
    if (dbSession?.claude_session_id) sessionId = dbSession.claude_session_id;
    if (dbSession?.project_id && !project) {
      project = db.prepare('SELECT * FROM projects WHERE id = ?').get(dbSession.project_id);
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

  // Chat mode determines cost and capability:
  // 'think' = cheap brainstorming, no tools, effort low (~$0.01/msg)
  // 'plan'  = can read files but not edit (~$0.03/msg)
  // 'agent' = full coding agent, can edit/run (~$0.05-0.15/msg)
  const chatMode = mode || 'think';

  if (chatMode === 'agent') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (chatMode === 'plan') {
    args.push('--allowedTools', 'Read,Glob,Grep');
  } else {
    // 'think' mode — just conversation. Cheapest.
    args.push('--effort', 'low');
  }

  const selectedModel = model || (chatMode === 'think' ? 'sonnet' : 'sonnet');
  if (selectedModel === 'opus') {
    args.push('--model', 'opus');
  } else if (selectedModel === 'haiku') {
    args.push('--model', 'haiku');
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
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin — Claude doesn't need it for -p mode
  });

  log.info(`[Chat] Spawned claude PID=${proc.pid} args=[${args.slice(0,3).join(',')},...] cwd=${cwd} mode=${chatMode}`);

  // Manual timeout
  const killTimer = setTimeout(() => {
    log.warn('[Chat] Timeout — killing process');
    proc.kill('SIGTERM');
  }, 5 * 60 * 1000);

  let fullOutput = '';
  let newSessionId = null;
  let cost = null;
  let lineBuffer = ''; // Handle JSON lines split across chunks

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    fullOutput += text;
    lineBuffer += text;

    // Split by newlines, keeping incomplete last line in buffer
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || ''; // Last element might be incomplete

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // Capture session_id from any event
        if (event.session_id) newSessionId = event.session_id;

        if (event.type === 'assistant') {
          // Stream assistant text content (full text, frontend replaces)
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
          newSessionId = event.session_id;
          cost = event.total_cost_usd;
          res.write(`data: ${JSON.stringify({ type: 'done', sessionId: event.session_id, cost: event.total_cost_usd, result: event.result })}\n\n`);
        }
      } catch {
        // Not valid JSON line — might be partial, will be completed in next chunk
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
    clearTimeout(killTimer);
    log.info(`[Chat] Process closed code=${code} output=${fullOutput.length}bytes session=${newSessionId?.slice(0,8) || 'none'}`);
    // Save session_id to task if we have one
    if (newSessionId && taskId) {
      try {
        db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(newSessionId, taskId);
      } catch {}
    }

    // Save messages to DB for persistence
    if (dbSessionId || dbSession) {
      const sid = dbSessionId || dbSession?.id;
      try {
        // Save user message
        db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)')
          .run(sid, 'user', message.trim());
        // Save assistant response
        if (fullOutput) {
          let resultText = fullOutput;
          try { resultText = JSON.parse(fullOutput)?.result || fullOutput; } catch {}
          // Try to get from the last result event
          const resultMatch = fullOutput.match(/"result":"((?:[^"\\]|\\.)*)"/);
          if (resultMatch) {
            try { resultText = JSON.parse('"' + resultMatch[1] + '"'); } catch {}
          }
          db.prepare('INSERT INTO chat_messages (session_id, role, content, cost) VALUES (?, ?, ?, ?)')
            .run(sid, 'assistant', resultText, cost);
        }
        // Update session with Claude's session_id and timestamp
        db.prepare("UPDATE chat_sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newSessionId, sid);
      } catch (e) {
        log.debug('[Chat] Failed to save messages: ' + e.message);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'close', code, sessionId: newSessionId })}\n\n`);
    res.end();
  });

  proc.on('error', (err) => {
    log.error(`[Chat] Spawn error: ${err.message}`);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  });

  // Handle client disconnect — only kill if response hasn't ended yet
  res.on('close', () => {
    if (!proc.killed && !res.writableEnded) {
      log.debug('[Chat] Client disconnected — killing process');
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
