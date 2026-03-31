const { v4: uuid } = require('uuid');
const { getDb } = require('../db');
const log = require('../utils/logger');

const DEFAULT_AGENTS = [
  {
    name: 'PM',
    role: 'pm',
    description: 'Product manager — plans features, decomposes work, tracks progress, reports status',
    system_prompt: 'You are a product manager AI. You understand the product goals, prioritize work, decompose features into tasks, and report progress to the human.',
  },
  {
    name: 'Engineer',
    role: 'engineer',
    description: 'Software engineer — writes code, fixes bugs, implements features',
    system_prompt: 'You are a software engineering AI. You write clean, tested code following project conventions.',
  },
  {
    name: 'Reviewer',
    role: 'reviewer',
    description: 'Code reviewer — reviews diffs, catches bugs, ensures quality',
    system_prompt: 'You are a code review AI. You review changes for correctness, security, and code quality.',
  },
];

function seedAgentsForProject(projectId) {
  const db = getDb();

  // Check if agents already exist for this project
  const existing = db.prepare('SELECT COUNT(*) as c FROM agents WHERE project_id = ?').get(projectId);
  if (existing.c > 0) return;

  for (const agent of DEFAULT_AGENTS) {
    db.prepare(`
      INSERT INTO agents (id, name, role, description, system_prompt, project_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), agent.name, agent.role, agent.description, agent.system_prompt, projectId);
  }

  log.info(`[Agents] Seeded default agents for project ${projectId}`);
}

function getProjectAgents(projectId) {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE project_id = ? AND active = 1 ORDER BY role').all(projectId);
}

function getAgent(agentId) {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
}

module.exports = { seedAgentsForProject, getProjectAgents, getAgent, DEFAULT_AGENTS };
