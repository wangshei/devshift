#!/usr/bin/env node
const { v4: uuid } = require('uuid');
const db = require('../src/db');
db.migrate();
const d = db.getDb();

const projectId = '0b7421af-7c28-4e6e-ad0e-469528d84e43';

// Create a "UI Redesign v2" feature
const featureId = uuid();
d.prepare('INSERT INTO features (id, project_id, title, description, status, priority) VALUES (?, ?, ?, ?, ?, ?)').run(
  featureId, projectId,
  'UI Redesign v2 — Product OS experience',
  'Complete UI overhaul based on PRODUCT.md vision. Feature-centric, clean, inspired by Linear/Notion/Slack. No developer jargon in default views.',
  'planned', 1
);

const tasks = [
  {
    title: 'Redesign Home/Dashboard as a command center with PM inbox and project status cards',
    description: `Read PRODUCT.md for the full vision. Rewrite dashboard/src/pages/Dashboard.jsx.

## Design
The home page should feel like opening Slack in the morning — you immediately see what happened and what needs you.

### Layout (top to bottom):
1. **Greeting + status bar**: "Good morning. Agent completed 5 tasks overnight. 2 need your review." One sentence. Below it: auto-pilot toggle (compact, inline) + "$0.42 spent this week" + "3 queued".

2. **PM Inbox** (only if unread reports exist): Cards from PM agents, each with project name, conversational summary (not jargon). "DevShift: Built the Product Map page and cost tracking. The self-update feature is ready for your review." Click to expand full report. Mark read button.

3. **Projects**: Each project is a card showing:
   - Name + colored status dot (green=active, yellow=review needed, gray=idle)
   - One-liner: "3 features in progress, 1 needs review" or "All caught up"
   - Active goal if set (small text)
   - Quick actions: "Open" button, "Chat" button
   - NO task-level details on home page

4. **Quick add**: TaskInput at bottom, same as now.

### Style
- Max width 3xl (wider than current 2xl)
- Clean white cards, subtle borders
- Use the existing theme vars (bg-card, border-border, text-text, etc.)
- Inspired by Linear's clean aesthetic

## Files to modify
- dashboard/src/pages/Dashboard.jsx (rewrite)

## Verification
npm run build`,
    tier: 2,
    priority: 1,
  },
  {
    title: 'Redesign Sidebar with cleaner nav, project status dots, and search',
    description: `Read PRODUCT.md. Rewrite dashboard/src/components/Sidebar.jsx.

## Design
The sidebar should be minimal and informative:

1. **DevShift logo** at top (keep existing)
2. **Main nav**: Home, My Work (with attention badge), Timeline, Settings — clean icons, active state highlight
3. **Projects section**:
   - "PROJECTS" label
   - Each project: status dot + name + review count badge (if any)
   - Hover: show map icon + remove button
   - "+ Add project" at bottom
4. **No clutter** — remove anything that isn't navigation

### Key changes from current:
- Nav items at TOP (before projects), not bottom
- Cleaner spacing
- Active state: accent left border, not just color change

## Files to modify
- dashboard/src/components/Sidebar.jsx (rewrite)

## Verification
npm run build`,
    tier: 2,
    priority: 1,
  },
  {
    title: 'Redesign Project page — feature progress as primary view with expandable details',
    description: `Read PRODUCT.md. Improve dashboard/src/pages/ProjectFeed.jsx.

## The current ProjectFeed was redesigned to be feature-centric but needs polish:

### Fix these issues:
1. Review actions not visible — when a task needs review, show clear "Review" button on the FEATURE card (not hidden inside expand)
2. Feature cards should show a human-readable summary, not just progress bar
3. The "What's happening" section should be more prominent — large text, not small
4. Completed features should collapse into a "5 features completed" summary, not show as dimmed cards
5. Ideas section needs better styling — feels like an afterthought

### Add:
1. **Feature detail expand**: When you click a feature, show:
   - Description and assumptions
   - Tasks as a mini checklist (with review/approve inline for needs_review tasks)
   - Comment thread
   - "Chat about this" button
2. **Active goal display**: Show the project's goals at the top with metric/target
3. **Agent activity summary**: "Agent completed 3 tasks today (12 min, $0.18)" — one line, not a feed

## Files to modify
- dashboard/src/pages/ProjectFeed.jsx

## Verification
npm run build`,
    tier: 2,
    priority: 2,
  },
  {
    title: 'Redesign My Work page — clean attention center with clear actions',
    description: `Read PRODUCT.md. Improve dashboard/src/pages/MyWork.jsx.

## Design
My Work should be the "do" page — everything that needs human action, with one-click actions.

### Sections:
1. **Your active sessions** (if any): Show task you're working on with "Continue" and "Hand off" buttons
2. **Review queue**: Features/tasks needing review. Each item shows:
   - Feature name (not task title)
   - What changed (1-line summary)
   - "Approve" and "View changes" buttons RIGHT ON THE CARD (no expanding needed)
3. **Suggested**: What the PM thinks you should work on next, based on goals and priorities
4. **Recently done**: Compact list — "5 tasks completed today by agent, 2 by you"

### Key principle: every item has a clear primary action button. No hunting for what to click.

## Files to modify
- dashboard/src/pages/MyWork.jsx

## Verification
npm run build`,
    tier: 2,
    priority: 2,
  },
  {
    title: 'Build ProductMap page — visual tree of goals, features, and progress',
    description: `Read PRODUCT.md. The ProductMap stub exists but needs a real implementation.

## Design
A visual tree showing the product hierarchy:

### Layout:
- **Goals** at top: large cards with metric/target, colored by status
- **Features** below each goal: medium cards with progress bars, connected by lines
- **Click a feature**: navigates to the project page with that feature expanded

### Styling:
- Vertical tree layout (not horizontal)
- Lines connecting goals to features
- Color coding: green=complete, blue=in-progress, yellow=needs-review, gray=planned
- Each node is clickable

### Data:
- GET /api/product/:projectId/goals
- GET /api/product/:projectId/features
- Calculate progress from tasks per feature

## Files to modify
- dashboard/src/pages/ProductMap.jsx (rewrite the stub)
- dashboard/src/App.jsx (ensure route exists)

## Verification
npm run build`,
    tier: 2,
    priority: 3,
  },
  {
    title: 'Add global keyboard shortcuts and polish transitions/animations',
    description: `Small UX polish pass across all pages.

## Add:
1. Keyboard shortcuts:
   - Cmd+K: focus task input (quick add)
   - Cmd+1/2/3/4: navigate Home/My Work/Timeline/Settings
   - Escape: close chat panel, close modals
2. Smooth transitions on page changes (fade in)
3. Loading skeletons instead of "Loading..." text
4. Toast notifications for actions (approved, rejected, saved) instead of alerts

## Files to modify
- dashboard/src/App.jsx (keyboard listener)
- Various pages (loading states)

## Verification
npm run build`,
    tier: 1,
    priority: 4,
  },
];

for (const t of tasks) {
  const id = uuid();
  d.prepare(`
    INSERT INTO tasks (id, project_id, title, description, tier, feature_id, priority, task_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', 'queued')
  `).run(id, projectId, t.title, t.description, t.tier, featureId, t.priority);
  console.log('Queued:', t.title.slice(0, 70));
}

console.log('\n6 tasks queued for UI redesign on branch redesign/ui-v2');
