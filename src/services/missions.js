const { getDb } = require('../db');
const { v4: uuid } = require('uuid');
const { spawnSync } = require('child_process');
const log = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Available missions — one-click comprehensive workflows
 */
const MISSIONS = {
  comprehensive_review: {
    name: 'Comprehensive Review',
    description: 'Review all features, generate report on what works and what doesn\'t',
    icon: 'clipboard',
    prompt: (project) => `You are reviewing the project "${project.name}" at ${project.repo_path}.

Do a comprehensive review:
1. Read the codebase structure, key files, routes, components
2. Test/check each major feature or module you find
3. Identify what's working well and what's broken or incomplete
4. Check for common issues: missing error handling, dead code, unused imports, broken links

Respond in this exact JSON format:
{
  "report": "## Comprehensive Review: ${project.name}\\n\\n### Working Well\\n- feature 1: details\\n\\n### Issues Found\\n- issue 1: details\\n\\n### Recommendations\\n- rec 1: details",
  "tasks": [
    {"title": "Fix: specific issue", "description": "what and why", "tier": 1},
    {"title": "Improve: specific area", "description": "what and why", "tier": 2}
  ]
}

Be specific — reference actual files, functions, components. Max 10 tasks. Output ONLY valid JSON.`,
  },

  ui_review: {
    name: 'UI/UX Review',
    description: 'Review frontend design, check screenshots, reference best practices',
    icon: 'eye',
    prompt: (project) => `You are a senior UI/UX engineer reviewing "${project.name}" at ${project.repo_path}.

1. Read all frontend components, pages, layouts, and styles
2. Evaluate: visual consistency, spacing, typography, color usage, responsive design
3. Check accessibility: contrast, labels, keyboard navigation, screen reader support
4. Compare against modern design standards (clean layouts, clear hierarchy, intuitive navigation)
5. Look for UI bugs: overflow, truncation, z-index issues, missing loading states, empty states

Respond in this exact JSON format:
{
  "report": "## UI/UX Review: ${project.name}\\n\\n### Design Quality\\n- assessment\\n\\n### Issues\\n- issue with fix suggestion\\n\\n### Improvements\\n- suggestion referencing best practice",
  "tasks": [
    {"title": "UI: specific fix", "description": "what's wrong and how to fix it", "tier": 1},
    {"title": "UX: improvement", "description": "details", "tier": 2}
  ]
}

Be specific about which components/files need changes. Max 8 tasks. Output ONLY valid JSON.`,
  },

  backend_review: {
    name: 'Backend Review',
    description: 'Review API, database, security, performance, error handling',
    icon: 'server',
    prompt: (project) => `You are a senior backend engineer reviewing "${project.name}" at ${project.repo_path}.

1. Read all routes, services, middleware, database schema
2. Check API design: consistency, validation, error responses, status codes
3. Check security: SQL injection, XSS, auth bypass, exposed secrets, CORS
4. Check performance: N+1 queries, missing indexes, large payloads, no pagination
5. Check reliability: error handling, edge cases, race conditions, missing null checks

Respond in this exact JSON format:
{
  "report": "## Backend Review: ${project.name}\\n\\n### Architecture\\n- assessment\\n\\n### Security Issues\\n- issue\\n\\n### Performance\\n- issue\\n\\n### Reliability\\n- issue",
  "tasks": [
    {"title": "Security: fix specific issue", "description": "details", "tier": 1},
    {"title": "Performance: optimize X", "description": "details", "tier": 2}
  ]
}

Be specific — reference actual files, routes, queries. Max 8 tasks. Output ONLY valid JSON.`,
  },

  quality_assessment: {
    name: 'Quality Assessment',
    description: 'Test edge cases, error handling, validation — find and fix bugs',
    icon: 'shield',
    prompt: (project) => `You are a QA engineer performing a thorough quality assessment of "${project.name}" at ${project.repo_path}.

1. Read the codebase and identify all user-facing features and API endpoints
2. For each feature/endpoint, think about edge cases:
   - Empty inputs, null values, missing fields
   - Very long strings, special characters, unicode
   - Concurrent access, race conditions
   - Network failures, timeout handling
   - Auth edge cases (expired tokens, missing headers)
3. Check existing tests — what's covered and what's missing
4. Look for error handling gaps — uncaught exceptions, missing try/catch

Respond in this exact JSON format:
{
  "report": "## Quality Assessment: ${project.name}\\n\\n### Test Coverage\\n- assessment\\n\\n### Edge Cases Found\\n- case 1: details\\n\\n### Missing Error Handling\\n- area: details",
  "tasks": [
    {"title": "Test: add tests for X", "description": "cover these edge cases: ...", "tier": 1},
    {"title": "Fix: handle edge case in Y", "description": "details", "tier": 1}
  ]
}

Be thorough — think like a pentester finding bugs. Max 10 tasks. Output ONLY valid JSON.`,
  },

  expansion_research: {
    name: 'Expansion Research',
    description: 'Research where the project should go next, then build it',
    icon: 'rocket',
    prompt: (project, goalMd) => `You are a product strategist and engineer for "${project.name}" at ${project.repo_path}.

${goalMd ? `Current product goal:\n${goalMd}\n` : ''}

1. Read the entire codebase to understand what exists
2. Analyze: what's the natural next version of this product?
3. Consider: what would make users love this? What's the competitive landscape?
4. Think about: integrations, new features, improved UX, mobile support, API expansion
5. Be practical — suggest things that can actually be built with the current tech stack

Respond in this exact JSON format:
{
  "report": "## Expansion Plan: ${project.name}\\n\\n### Current State\\n- summary\\n\\n### Recommended Next Version\\n- vision\\n\\n### Feature Roadmap\\n1. feature (effort estimate)\\n2. feature",
  "tasks": [
    {"title": "Build: new feature X", "description": "what, why, and approach", "tier": 2},
    {"title": "Research: investigate Y", "description": "what to explore", "tier": 3}
  ]
}

Think big but practical. Max 8 tasks ordered by impact. Output ONLY valid JSON.`,
  },

  research_competitive: {
    name: 'Competitive Analysis',
    description: 'Research competitors, find gaps and opportunities',
    icon: 'search',
    prompt: (project, goalMd) => `You are a product researcher analyzing the competitive landscape for "${project.name}" at ${project.repo_path}.

${goalMd ? `Product goal:\n${goalMd}\n` : ''}

1. Read the codebase to understand exactly what this product does
2. Based on the features and target audience, identify the top 3-5 competitors or similar products
3. For each competitor: what they do well, what they lack
4. Identify gaps where this product could differentiate
5. Suggest specific features or approaches based on competitive insights

Respond in JSON:
{
  "report": "## Competitive Analysis: ${project.name}\\n\\n### Product Summary\\n...\\n\\n### Competitors\\n#### Competitor 1\\n- Strengths: ...\\n- Weaknesses: ...\\n\\n### Opportunities\\n...\\n\\n### Recommended Differentiators\\n...",
  "tasks": [
    {"title": "Research: deep dive on X approach", "description": "details", "tier": 3},
    {"title": "Build: differentiating feature Y", "description": "details", "tier": 2}
  ]
}

Be specific to this actual product, not generic. Max 6 tasks. Output ONLY valid JSON.`,
  },

  research_architecture: {
    name: 'Architecture Deep Dive',
    description: 'Analyze architecture, find scalability issues, propose improvements',
    icon: 'layers',
    prompt: (project, goalMd) => `You are a senior architect reviewing "${project.name}" at ${project.repo_path}.

${goalMd ? `Product goal:\n${goalMd}\n` : ''}

1. Read the full codebase structure — every directory, key files, configs
2. Map the architecture: data flow, component relationships, API boundaries
3. Identify: tight coupling, missing abstractions, scalability bottlenecks
4. Consider: how would this need to change to handle 10x/100x more users?
5. Propose concrete architectural improvements that can be done incrementally

Respond in JSON:
{
  "report": "## Architecture Review: ${project.name}\\n\\n### Current Architecture\\n- data flow diagram in text\\n\\n### Strengths\\n...\\n\\n### Bottlenecks\\n...\\n\\n### Recommended Changes\\n...",
  "tasks": [
    {"title": "Refactor: decouple X from Y", "description": "why and how", "tier": 2},
    {"title": "Architecture: add caching layer for Z", "description": "details", "tier": 2}
  ]
}

Reference actual files and modules. Max 6 tasks. Output ONLY valid JSON.`,
  },

  research_user_experience: {
    name: 'User Experience Research',
    description: 'How might users engage with this product? Improve interaction quality',
    icon: 'users',
    prompt: (project, goalMd) => `You are a UX researcher studying "${project.name}" at ${project.repo_path}.

${goalMd ? `Product goal:\n${goalMd}\n` : ''}

1. Read the frontend code — pages, components, user flows, forms, navigation
2. Map every user journey: onboarding, core actions, settings, edge cases
3. For each journey: what friction exists? Where do users get confused or stuck?
4. Consider: what would delight users? What's unexpectedly hard?
5. Think about: notification design, empty states, error recovery, progressive disclosure
6. How should the human-agent collaboration feel? What feedback loops are missing?

Respond in JSON:
{
  "report": "## UX Research: ${project.name}\\n\\n### User Journeys\\n1. journey: assessment\\n\\n### Friction Points\\n...\\n\\n### Delight Opportunities\\n...\\n\\n### Human-Agent Collaboration\\n- how interaction could improve",
  "tasks": [
    {"title": "UX: improve onboarding flow", "description": "specific changes", "tier": 2},
    {"title": "UX: add feedback for X action", "description": "details", "tier": 1}
  ]
}

Be specific about which screens/components need changes. Max 8 tasks. Output ONLY valid JSON.`,
  },

  research_implementation: {
    name: 'Implementation Research',
    description: 'Research how to build specific features, produce implementation plans',
    icon: 'book',
    prompt: (project, goalMd) => `You are a senior engineer researching implementation approaches for "${project.name}" at ${project.repo_path}.

${goalMd ? `Product goal:\n${goalMd}\n` : ''}

1. Read the codebase to understand the current tech stack and patterns
2. Identify the top 3-5 features or improvements that would have the biggest impact
3. For each: research the best implementation approach within the current framework
4. Consider: what libraries, APIs, or patterns would work best?
5. Produce a concrete implementation plan for each — files to change, approach, estimated complexity

Respond in JSON:
{
  "report": "## Implementation Research: ${project.name}\\n\\n### Feature 1: Name\\n#### Approach\\n...\\n#### Files to change\\n...\\n#### Estimated effort\\n...\\n\\n### Feature 2: Name\\n...",
  "tasks": [
    {"title": "Implement: feature X - step 1", "description": "specific implementation plan", "tier": 2},
    {"title": "Implement: feature X - step 2", "description": "details", "tier": 2}
  ]
}

Be very specific — list exact files, functions, and code patterns. Max 8 tasks. Output ONLY valid JSON.`,
  },
};

/**
 * Run a mission on a project
 */
async function runMission(projectId, missionType) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Project not found');

  const mission = MISSIONS[missionType];
  if (!mission) throw new Error(`Unknown mission: ${missionType}`);

  const prompt = mission.prompt(project, project.goal_md);

  const result = spawnSync('claude', ['-p', '--output-format', 'text'], {
    cwd: project.repo_path,
    input: prompt,
    encoding: 'utf-8',
    timeout: 180000, // 3 min for thorough analysis
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Exit code ${result.status}`);

  const text = result.stdout.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return { report: text, tasks: [], tasksCreated: 0 };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  let tasksCreated = 0;

  // Create tasks from suggestions
  if (parsed.tasks && Array.isArray(parsed.tasks)) {
    for (const task of parsed.tasks.slice(0, 10)) {
      if (!task.title) continue;
      db.prepare(`
        INSERT INTO tasks (id, project_id, title, description, task_type, tier, status, priority)
        VALUES (?, ?, ?, ?, 'agent', ?, 'suggested', 10)
      `).run(uuid(), projectId, task.title, task.description || null, task.tier || 2);
      tasksCreated++;
    }
  }

  // Save report to project context (append, don't overwrite)
  const reportMd = parsed.report || text;

  log.info(`[Mission] ${mission.name} on "${project.name}": ${tasksCreated} tasks created`);

  return { report: reportMd, tasksCreated, missionType };
}

module.exports = { MISSIONS, runMission };
