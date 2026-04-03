const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_PATH, DATA_DIR } = require('./utils/config');
const log = require('./utils/logger');

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  log.info(`Database opened at ${DB_PATH}`);
  return db;
}

function migrate() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      github_remote TEXT,
      context TEXT,
      preferences TEXT,
      status_summary TEXT,
      priority INTEGER DEFAULT 5,
      paused INTEGER DEFAULT 0,
      focus_mode INTEGER DEFAULT 0,
      auto_approve_tiers TEXT DEFAULT '1',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      task_type TEXT DEFAULT 'agent',
      tier INTEGER DEFAULT 2,
      status TEXT DEFAULT 'backlog',
      priority INTEGER DEFAULT 5,
      deadline TEXT,
      pre_approved INTEGER DEFAULT 0,
      branch_name TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      result_summary TEXT,
      review_instructions TEXT,
      execution_log TEXT,
      model TEXT DEFAULT 'sonnet',
      provider TEXT DEFAULT 'claude_code',
      estimated_minutes INTEGER,
      actual_minutes INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      parent_task_id TEXT
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      cli_command TEXT,
      auth_status TEXT DEFAULT 'unknown',
      plan_tier TEXT,
      use_for_tiers TEXT DEFAULT '1,2,3',
      priority INTEGER DEFAULT 1,
      rate_limited_until TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY DEFAULT 1,
      timezone TEXT DEFAULT 'America/Los_Angeles',
      active_hours_start TEXT DEFAULT '09:00',
      active_hours_end TEXT DEFAULT '18:00',
      active_days TEXT DEFAULT '1,2,3,4,5',
      vacation_mode INTEGER DEFAULT 0,
      vacation_until TEXT,
      off_today INTEGER DEFAULT 0,
      primary_provider TEXT DEFAULT 'claude_code',
      max_tasks_per_window INTEGER DEFAULT 6,
      reserve_percent INTEGER DEFAULT 40,
      telegram_bot_token TEXT,
      telegram_chat_id TEXT,
      setup_complete INTEGER DEFAULT 0,
      always_on INTEGER DEFAULT 0,
      last_checkin TEXT
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id),
      project_id TEXT REFERENCES projects(id),
      started_at TEXT,
      completed_at TEXT,
      status TEXT,
      output TEXT,
      provider TEXT,
      model TEXT,
      estimated_credits REAL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS changelog (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      timestamp TEXT DEFAULT (datetime('now')),
      summary TEXT,
      tasks_completed TEXT,
      rollback_tag TEXT
    );
  `);

  // Ensure default schedule row exists
  const existing = database.prepare('SELECT id FROM schedule WHERE id = 1').get();
  if (!existing) {
    database.prepare('INSERT INTO schedule (id) VALUES (1)').run();
  }

  // Migration: add log_path column to executions if missing
  const execCols = database.prepare("PRAGMA table_info(executions)").all();
  if (!execCols.find(c => c.name === 'log_path')) {
    database.exec('ALTER TABLE executions ADD COLUMN log_path TEXT');
  }

  // Migration: add paused and focus_mode columns to projects if missing
  const projectCols = database.prepare("PRAGMA table_info(projects)").all();
  if (!projectCols.find(c => c.name === 'paused')) {
    database.exec('ALTER TABLE projects ADD COLUMN paused INTEGER DEFAULT 0');
  }
  if (!projectCols.find(c => c.name === 'focus_mode')) {
    database.exec('ALTER TABLE projects ADD COLUMN focus_mode INTEGER DEFAULT 0');
  }

  // Migration: add setup_complete column if missing (existing DBs)
  const cols = database.prepare("PRAGMA table_info(schedule)").all();
  if (!cols.find(c => c.name === 'setup_complete')) {
    database.exec('ALTER TABLE schedule ADD COLUMN setup_complete INTEGER DEFAULT 0');
  }
  if (!cols.find(c => c.name === 'always_on')) {
    database.exec('ALTER TABLE schedule ADD COLUMN always_on INTEGER DEFAULT 0');
  }
  if (!cols.find(c => c.name === 'last_checkin')) {
    database.exec("ALTER TABLE schedule ADD COLUMN last_checkin TEXT");
  }

  // Migration: add auto_approve_tiers column to projects if missing
  if (!projectCols.find(c => c.name === 'auto_approve_tiers')) {
    database.exec("ALTER TABLE projects ADD COLUMN auto_approve_tiers TEXT DEFAULT '1'");
  }

  // Migration: add stack column to projects for tech stack detection
  if (!projectCols.find(c => c.name === 'stack')) {
    database.exec("ALTER TABLE projects ADD COLUMN stack TEXT");
  }

  // Migration: add session_id column to tasks if missing
  const taskCols = database.prepare("PRAGMA table_info(tasks)").all();
  if (!taskCols.find(c => c.name === 'session_id')) {
    database.exec('ALTER TABLE tasks ADD COLUMN session_id TEXT');
  }

  // Migration: add actual_cost_usd column to executions if missing
  const execCols2 = database.prepare("PRAGMA table_info(executions)").all();
  if (!execCols2.find(c => c.name === 'actual_cost_usd')) {
    database.exec('ALTER TABLE executions ADD COLUMN actual_cost_usd REAL');
  }

  // Migration: task_comments table
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      author TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add image_url to task_comments
  try {
    const commentCols = database.prepare("PRAGMA table_info(task_comments)").all();
    if (!commentCols.find(c => c.name === 'image_url')) {
      database.exec("ALTER TABLE task_comments ADD COLUMN image_url TEXT");
    }
  } catch {}

  // Migration: project_memory table — per-project learnings
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source_task_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: system_memory table — cross-project DevShift learnings
  database.exec(`
    CREATE TABLE IF NOT EXISTS system_memory (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source_project_id TEXT,
      source_task_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add plan_status column to tasks for PM review gate
  const taskCols2 = database.prepare("PRAGMA table_info(tasks)").all();
  if (!taskCols2.find(c => c.name === 'plan_status')) {
    database.exec("ALTER TABLE tasks ADD COLUMN plan_status TEXT DEFAULT 'auto'");
  }

  // Migration: add worker column to track who is working on a task
  if (!taskCols2.find(c => c.name === 'worker')) {
    database.exec("ALTER TABLE tasks ADD COLUMN worker TEXT DEFAULT 'agent'");
  }

  // Migration: add memory limit columns to schedule
  const schCols2 = database.prepare("PRAGMA table_info(schedule)").all();
  if (!schCols2.find(c => c.name === 'memory_per_category')) {
    database.exec("ALTER TABLE schedule ADD COLUMN memory_per_category INTEGER DEFAULT 20");
  }
  if (!schCols2.find(c => c.name === 'memory_system_max')) {
    database.exec("ALTER TABLE schedule ADD COLUMN memory_system_max INTEGER DEFAULT 30");
  }
  if (!schCols2.find(c => c.name === 'log_retention_days')) {
    database.exec("ALTER TABLE schedule ADD COLUMN log_retention_days INTEGER DEFAULT 7");
  }

  // Migration: add blocked_slots to schedule
  try {
    const schCols3 = database.prepare("PRAGMA table_info(schedule)").all();
    if (!schCols3.find(c => c.name === 'blocked_slots')) {
      database.exec("ALTER TABLE schedule ADD COLUMN blocked_slots TEXT DEFAULT '[]'");
    }
  } catch {}

  // === Product OS tables ===

  // Goals: the "why" behind features (e.g., "increase retention by 20%")
  database.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      metric TEXT,
      target_value TEXT,
      current_value TEXT,
      status TEXT DEFAULT 'active',
      deadline TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Features: the "what" that serves a goal (e.g., "onboarding flow")
  database.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      goal_id TEXT REFERENCES goals(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'idea',
      priority INTEGER DEFAULT 5,
      assumptions TEXT,
      outcome TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Link tasks to features
  const taskCols3 = database.prepare("PRAGMA table_info(tasks)").all();
  if (!taskCols3.find(c => c.name === 'feature_id')) {
    database.exec("ALTER TABLE tasks ADD COLUMN feature_id TEXT REFERENCES features(id)");
  }

  // Sprints: time-boxed work periods
  database.exec(`
    CREATE TABLE IF NOT EXISTS sprints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      goal TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'planning',
      retrospective TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Link tasks to sprints
  if (!taskCols3.find(c => c.name === 'sprint_id')) {
    database.exec("ALTER TABLE tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id)");
  }

  // Agent profiles: each agent has identity, expertise, and history
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT,
      avatar TEXT,
      provider TEXT DEFAULT 'claude_code',
      model TEXT DEFAULT 'sonnet',
      system_prompt TEXT,
      project_id TEXT REFERENCES projects(id),
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PM reports: periodic summaries from the PM agent to the human
  database.exec(`
    CREATE TABLE IF NOT EXISTS pm_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      agent_id TEXT REFERENCES agents(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Ideas: feature ideas / tickets dumped by human or agent
  database.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      source TEXT DEFAULT 'human',
      priority INTEGER DEFAULT 5,
      status TEXT DEFAULT 'new',
      promoted_to_feature_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration: add memory_tier to project_memory and system_memory
  try {
    const pmCols = database.prepare("PRAGMA table_info(project_memory)").all();
    if (!pmCols.find(c => c.name === 'memory_tier')) {
      database.exec("ALTER TABLE project_memory ADD COLUMN memory_tier TEXT DEFAULT 'working'");
    }
    const smCols = database.prepare("PRAGMA table_info(system_memory)").all();
    if (!smCols.find(c => c.name === 'memory_tier')) {
      database.exec("ALTER TABLE system_memory ADD COLUMN memory_tier TEXT DEFAULT 'working'");
    }
  } catch {}

  // Migration: chat_sessions and chat_messages for persistent multi-session chat
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      task_id TEXT,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      mode TEXT DEFAULT 'think',
      model TEXT DEFAULT 'sonnet',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      cost REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  log.info('Database migration complete');
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, migrate, close };
