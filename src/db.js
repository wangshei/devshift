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
      telegram_chat_id TEXT
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

  log.info('Database migration complete');
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, migrate, close };
