# DevShift

Local tool for developers who pay for AI coding subscriptions. Routes tasks to AI agents during off-hours.

## Stack
- Backend: Node.js 20+, Express, better-sqlite3, node-cron
- Frontend: React (Vite), Tailwind CSS (v4), PWA
- Telegram: node-telegram-bot-api
- No TypeScript — plain JS with JSDoc

## Structure
- `src/server.js` — Express app entry point (port 3847)
- `src/db.js` — SQLite setup + migrations
- `src/routes/` — API route handlers
- `src/providers/` — AI tool integrations (Claude Code, Antigravity, Cursor)
- `src/services/` — Core logic (scheduler, executor, classifier, planner, telegram, digest)
- `dashboard/` — React frontend (Vite)
- `landing/` — GitHub Pages landing page

## Commands
- `npm start` — Start the server
- `npm run build` — Build the dashboard
- `npm run setup` — Interactive setup wizard

## Key design decisions
- SQLite for all data — no external services
- Provider plugin pattern for AI tools
- Cron-based scheduler (every minute)
- Tasks auto-classified into tiers (1=auto, 2=review, 3=research)
- Credit tracking is approximate, based on task count/tier
