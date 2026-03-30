const TelegramBot = require('node-telegram-bot-api');
const { getDb } = require('../db');
const { v4: uuid } = require('uuid');
const { classify } = require('./classifier');
const log = require('../utils/logger');

let bot = null;

/**
 * Initialize and start the Telegram bot.
 */
function start() {
  const db = getDb();
  const schedule = db.prepare('SELECT telegram_bot_token, telegram_chat_id FROM schedule WHERE id = 1').get();

  if (!schedule.telegram_bot_token) {
    log.info('Telegram bot not configured — skipping');
    return null;
  }

  bot = new TelegramBot(schedule.telegram_bot_token, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = (msg.text || '').trim();

    // Save chat ID on first message if not set
    if (!schedule.telegram_chat_id) {
      db.prepare('UPDATE schedule SET telegram_chat_id = ? WHERE id = 1').run(chatId);
      log.info(`Telegram chat ID saved: ${chatId}`);
    }

    try {
      await handleMessage(chatId, text);
    } catch (e) {
      log.error('Telegram handler error:', e.message);
      bot.sendMessage(chatId, `Error: ${e.message}`);
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id.toString();
    const data = query.data;

    try {
      await handleCallback(chatId, data, query.id);
    } catch (e) {
      log.error('Telegram callback error:', e.message);
    }
  });

  log.info('Telegram bot started');
  return bot;
}

async function handleMessage(chatId, text) {
  if (!text) return;
  const lower = text.toLowerCase();

  // Status query
  if (lower === 'status' || lower === '/status') {
    return sendStatus(chatId);
  }

  // Done for today
  if (lower === 'done' || lower === 'done for today' || lower === '/done') {
    return handleDone(chatId);
  }

  // Off until
  const offMatch = lower.match(/^off until (.+)/i);
  if (offMatch) {
    return handleOffUntil(chatId, offMatch[1]);
  }

  // I'm back
  if (lower === "i'm back" || lower === 'im back' || lower === '/back') {
    return handleImBack(chatId);
  }

  // Help
  if (lower === '/help' || lower === 'help') {
    return bot.sendMessage(chatId, [
      '*DevShift Bot Commands*',
      '',
      '`ProjectName: task description` — Add a task',
      '`urgent ProjectName: task` — Add urgent task',
      '`status` — Current agent status',
      '`done` — Done for today',
      '`off until Monday` — Vacation mode',
      "`i'm back` — Resume active hours",
      '`help` — This message',
    ].join('\n'), { parse_mode: 'Markdown' });
  }

  // Task input: "ProjectName: task description" or just "task description"
  return addTask(chatId, text);
}

async function sendStatus(chatId) {
  const db = getDb();
  const inProgress = db.prepare("SELECT * FROM tasks WHERE status = 'in_progress'").get();
  const backlog = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('backlog', 'queued') AND task_type = 'agent'").get();
  const needsReview = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'needs_review'").get();
  const completedToday = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at > date('now')").get();
  const schedule = db.prepare('SELECT * FROM schedule WHERE id = 1').get();

  const status = inProgress
    ? `Working on: "${inProgress.title}"`
    : 'Agent idle';
  const mode = schedule.vacation_mode ? ' (vacation mode)' : schedule.off_today ? ' (off today)' : '';

  bot.sendMessage(chatId, [
    `${inProgress ? '🟢' : '⚪'} ${status}${mode}`,
    `${completedToday.count} completed today, ${needsReview.count} need review`,
    `${backlog.count} tasks in backlog`,
  ].join('\n'));
}

async function handleDone(chatId) {
  const db = getDb();
  db.prepare('UPDATE schedule SET off_today = 1 WHERE id = 1').run();
  const backlog = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('backlog', 'queued') AND task_type = 'agent'").get();

  bot.sendMessage(chatId,
    `✓ Agent unlocked — will work through ${backlog.count} backlog tasks tonight.`);
}

async function handleOffUntil(chatId, dateStr) {
  const db = getDb();
  // Try to parse the date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    // Try common patterns like "monday", "friday"
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIdx = days.indexOf(dateStr.toLowerCase());
    if (dayIdx >= 0) {
      const now = new Date();
      const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
      date.setTime(now.getTime() + diff * 24 * 60 * 60 * 1000);
      date.setHours(9, 0, 0, 0);
    } else {
      return bot.sendMessage(chatId, 'Could not parse date. Try: "off until Monday" or "off until 2026-03-25"');
    }
  }

  const until = date.toISOString().split('T')[0];
  db.prepare('UPDATE schedule SET vacation_mode = 1, vacation_until = ? WHERE id = 1').run(until);
  bot.sendMessage(chatId,
    `✓ Vacation mode until ${until}. Agent will work through the full backlog.`);
}

async function handleImBack(chatId) {
  const db = getDb();
  db.prepare('UPDATE schedule SET vacation_mode = 0, vacation_until = NULL, off_today = 0 WHERE id = 1').run();
  bot.sendMessage(chatId, '✓ Welcome back! Agent paused during your active hours.');
}

async function addTask(chatId, text) {
  const db = getDb();

  // Check for "urgent" prefix
  let urgent = false;
  let taskText = text;
  if (taskText.toLowerCase().startsWith('urgent ')) {
    urgent = true;
    taskText = taskText.slice(7);
  }

  // Check for "ProjectName: task" pattern
  let projectId = null;
  let title = taskText;
  const colonMatch = taskText.match(/^([^:]+):\s*(.+)/);
  if (colonMatch) {
    const projectName = colonMatch[1].trim();
    const project = db.prepare('SELECT id FROM projects WHERE name LIKE ?').get(`%${projectName}%`);
    if (project) {
      projectId = project.id;
      title = colonMatch[2].trim();
    }
  }

  // If no project matched, use the first/default project
  if (!projectId) {
    const defaultProject = db.prepare('SELECT id FROM projects ORDER BY priority ASC LIMIT 1').get();
    if (!defaultProject) {
      return bot.sendMessage(chatId, 'No projects configured. Add a project in the dashboard first.');
    }
    projectId = defaultProject.id;
  }

  const classification = classify(title);
  const id = uuid();
  db.prepare(`
    INSERT INTO tasks (id, project_id, title, task_type, tier, priority, model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, title, classification.task_type, classification.tier,
    urgent ? 1 : 5, classification.model);

  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  const tierLabel = { 1: 'auto-merge', 2: 'needs review', 3: 'research' }[classification.tier] || '';

  bot.sendMessage(chatId,
    `✓ Added to ${project.name} (Tier ${classification.tier} — ${tierLabel})${urgent ? ' — URGENT' : ''}`);
}

/**
 * Send a notification to the configured chat.
 */
function notify(message, options = {}) {
  if (!bot) return;
  const db = getDb();
  const schedule = db.prepare('SELECT telegram_chat_id FROM schedule WHERE id = 1').get();
  if (!schedule.telegram_chat_id) return;

  bot.sendMessage(schedule.telegram_chat_id, message, options);
}

/**
 * Send a PR review notification with approve/reject buttons.
 */
function notifyPRReady(task) {
  if (!bot) return;
  const db = getDb();
  const schedule = db.prepare('SELECT telegram_chat_id FROM schedule WHERE id = 1').get();
  if (!schedule.telegram_chat_id) return;

  const message = [
    `PR ready for review: "${task.title}"`,
    task.result_summary ? `\n${task.result_summary.slice(0, 200)}` : '',
    task.review_instructions ? `\nCheck: ${task.review_instructions}` : '',
  ].join('');

  const keyboard = {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${task.id}` },
        { text: '👀 View PR', url: task.pr_url || '#' },
        { text: '⏭ Skip', callback_data: `skip:${task.id}` },
      ]],
    },
  };

  bot.sendMessage(schedule.telegram_chat_id, message, keyboard);
}

async function handleCallback(chatId, data, queryId) {
  const [action, taskId] = data.split(':');
  const db = getDb();

  if (action === 'approve') {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (task) {
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
      if (project && task.branch_name) {
        const gitUtils = require('../utils/git');
        try {
          const defaultBranch = gitUtils.getDefaultBranch(project.repo_path);
          gitUtils.checkout(project.repo_path, defaultBranch);
          gitUtils.mergeBranch(project.repo_path, task.branch_name);
          gitUtils.deleteBranch(project.repo_path, task.branch_name);
        } catch (e) {
          log.error('Git merge error during approve:', e.message);
          bot.sendMessage(chatId, `Warning: Could not merge branch — ${e.message}`);
        }
      }
    }
    db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(taskId);
    bot.answerCallbackQuery(queryId, { text: 'Approved!' });
    bot.sendMessage(chatId, '✓ Task approved and marked as done.');
  } else if (action === 'skip') {
    bot.answerCallbackQuery(queryId, { text: 'Skipped' });
    bot.sendMessage(chatId, 'Skipped — task remains in review.');
  }
}

function stop() {
  if (bot) {
    bot.stopPolling();
    bot = null;
    log.info('Telegram bot stopped');
  }
}

module.exports = { start, stop, notify, notifyPRReady };
