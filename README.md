# DevShift

> A shared to-do list between you and your AI coding tools — it knows who should do what, and when.

Queue tasks from your phone or Telegram. Your AI coding tools work while you sleep. Wake up to progress.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/devshift.git
cd devshift
npm install
cd dashboard && npm install && npx vite build && cd ..
npm run setup    # interactive setup wizard
npm start        # starts on http://localhost:3847
```

## What It Does

DevShift is a **collaboration layer between you and your AI coding tools**. You dump tasks into it — from your phone, Telegram, your laptop — and it figures out:

- **Which tasks an AI agent can handle autonomously** (tests, docs, lint fixes, boilerplate)
- **Which tasks need you** (design decisions, credentials, code review)
- **When to run agent work** (during your off-hours, respecting rate limits and credits)

When you come back, you see a clean summary of what changed.

## Supported Providers

| Provider | CLI | Best For |
|----------|-----|----------|
| **Claude Code** | `claude` | Complex features, research, Opus-level work |
| **Google Antigravity** | `agy` | Simple tasks, free credits |
| **Cursor** | `cursor` | General coding tasks |

DevShift auto-detects which tools you have installed and routes tasks intelligently.

## Features

- **Timeline dashboard** — see what's done, what's running, what needs you
- **Auto-classification** — tasks are classified as agent/human work with tier assignment
- **Smart scheduling** — agent works during your off-hours, respects credit limits
- **Multi-provider** — use one AI tool or many, with automatic fallback
- **Telegram bot** — add tasks, check status, approve PRs from your phone
- **Credit tracking** — monitors usage, reserves credits for your active coding
- **PWA** — installable on your phone's home screen
- **Git integration** — branch per task, atomic commits, PR creation

## Dashboard

Dark theme, data-dense, Mission Control aesthetic. Access from any device at `localhost:3847`.

The main screen is a **timeline** — not a Kanban board — showing:
- Human tasks that need your attention (top)
- Agent activity (completed, in-progress, planned)
- Credit usage gauge
- "I'm done for today" / "I'm off until" quick actions

## Telegram Bot

The fastest way to interact:

```
You: ProductA: add dark mode to settings
Bot: ✓ Added to ProductA backlog (Tier 2 — needs review)

You: status
Bot: 🟢 Agent running — working on "Add tests for auth"
     3 tasks completed today, 2 need your review

You: done for today
Bot: ✓ Agent unlocked — will work through 5 backlog tasks tonight.
```

Setup: Create a bot via @BotFather, paste the token during `npm run setup`.

## Architecture

- **Backend**: Node.js, Express, SQLite (better-sqlite3), node-cron
- **Frontend**: React (Vite), Tailwind CSS, PWA
- **Execution**: Provider plugin system with standard interface
- **No external services** — everything runs locally

## How It Works

1. You add a task (dashboard, Telegram, or API)
2. DevShift classifies it: agent work vs human work, tier 1/2/3
3. During your off-hours, the scheduler picks tasks by priority
4. The execution engine: creates a branch → picks a provider → executes → commits → creates PR
5. Tier 1 tasks auto-merge; Tier 2 tasks surface for your review
6. You see a clean summary of everything that happened

## License

MIT

---

*Built for builders who have more ideas than hours.*
