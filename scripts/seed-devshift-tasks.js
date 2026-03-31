#!/usr/bin/env node
const { v4: uuid } = require('uuid');
const db = require('../src/db');
db.migrate();
const d = db.getDb();

const projectId = '0b7421af-7c28-4e6e-ad0e-469528d84e43';

// Get feature IDs
const productMap = d.prepare("SELECT id FROM features WHERE project_id = ? AND title LIKE '%Product Map%'").get(projectId);
const selfUpdate = d.prepare("SELECT id FROM features WHERE project_id = ? AND title LIKE '%Self-update%'").get(projectId);
const smartProvider = d.prepare("SELECT id FROM features WHERE project_id = ? AND title LIKE '%Smart provider%'").get(projectId);
const atRef = d.prepare("SELECT id FROM features WHERE project_id = ? AND title LIKE '%@ reference%'").get(projectId);
const agentChat = d.prepare("SELECT id FROM features WHERE project_id = ? AND title LIKE '%Agent chat%'").get(projectId);

const tasks = [
  {
    title: 'Build Product Map page — visual goals/features/tasks tree in dashboard/src/pages/ProductMap.jsx',
    description: `## What to build
A new page at /product-map/:projectId showing a visual tree layout:
- Goals at top (large cards with metric/target)
- Features connected below goals (medium cards with status)
- Tasks as small items under features
- Click any node to see details
- Status colors: green=done, blue=active, yellow=review, gray=planned

## Files to create
- dashboard/src/pages/ProductMap.jsx

## Files to modify
- dashboard/src/App.jsx (add route)
- dashboard/src/components/Sidebar.jsx (add nav link)

## Data sources
- GET /api/product/:projectId/goals
- GET /api/product/:projectId/features
- GET /api/tasks?project_id=:projectId

## Acceptance criteria
- Tree renders goals -> features -> tasks hierarchy
- Status colors work
- Click navigates to details
- Empty states handled

## Verification
Run npm run build to confirm no errors`,
    tier: 2,
    feature_id: productMap?.id,
    priority: 1,
  },
  {
    title: 'Add self-update service in src/services/self-update.js',
    description: `## What to build
A service that lets DevShift propose changes to its own codebase safely.

## How it works
1. Smart Mode improvements for devshift go through normal execution on a branch
2. Self-update service verifies: npm run build passes, node modules load
3. Creates PM report with changes summary
4. User reviews and clicks "Apply update" or "Discard"
5. Apply = merge branch. Discard = delete branch.
6. Store previous commit hash for rollback.

## Files to create
- src/services/self-update.js (exports: checkForUpdate, applyUpdate, rollback)

## Files to modify
- src/routes/product.js (add GET/POST /api/product/updates endpoints)

## Acceptance criteria
- Module loads without errors
- Can list pending update branches
- Can apply (merge) or discard (delete branch)
- Rollback stores and can restore previous commit

## Verification
Run node -e "require('./src/services/self-update')" to confirm`,
    tier: 2,
    feature_id: selfUpdate?.id,
    priority: 2,
  },
  {
    title: 'Enhance planner.js with real cost tracking and plan-aware provider routing',
    description: `## What to build
Update src/services/planner.js to use real execution costs instead of fake credit units.

## Changes
1. getCreditUsage() should sum actual_cost_usd from executions table
2. canAffordTask() should estimate based on real costs (sonnet ~$0.04/task, opus ~$0.15/task)
3. Add provider cost awareness: track cost per provider, prefer cheaper when sufficient
4. Log provider selection decisions

## Files to modify
- src/services/planner.js

## Verification
Run node -e "require('./src/services/planner')" to confirm`,
    tier: 2,
    feature_id: smartProvider?.id,
    priority: 2,
  },
  {
    title: 'Add @ reference parsing to chat — search memory and codebase on @keyword',
    description: `## What to build
In src/routes/chat.js, parse @references from user messages before sending to Claude.

## How it works
1. Extract @word patterns from message text
2. For each @word, search project_memory via searchMemory()
3. Also grep the codebase for the keyword
4. Inject found context into the Claude prompt
5. In ChatPanel.jsx, visually highlight @references

## Files to modify
- src/routes/chat.js
- dashboard/src/components/ChatPanel.jsx

## Verification
Run npm run build to confirm`,
    tier: 2,
    feature_id: atRef?.id,
    priority: 3,
  },
  {
    title: 'Build agent activity feed — show what each agent did as a conversation thread',
    description: `## What to build
In ProjectFeed, add an agent activity section showing work as a chat-like thread.

## Each entry shows
- Agent name/avatar badge
- What it did (decomposed, coded, reviewed, etc.)
- Timestamp and duration
- Result preview

## How to get data
- Query tasks by project, join with agents table
- PM tasks = decompositions
- Engineer tasks = code execution
- Reviewer = review results
- Human = manual work

## Files to modify
- dashboard/src/pages/ProjectFeed.jsx

## Verification
Run npm run build to confirm`,
    tier: 2,
    feature_id: agentChat?.id,
    priority: 3,
  },
];

for (const t of tasks) {
  const id = uuid();
  d.prepare(`
    INSERT INTO tasks (id, project_id, title, description, tier, feature_id, priority, task_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', 'queued')
  `).run(id, projectId, t.title, t.description, t.tier, t.feature_id || null, t.priority);
  console.log('Queued:', t.title.slice(0, 70));
}

const queued = d.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'queued'").get(projectId);
console.log('\nTotal queued for DevShift:', queued.c, 'tasks');
console.log('The scheduler will pick these up on the next tick.');
