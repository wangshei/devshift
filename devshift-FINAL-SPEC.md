# DevShift — Definitive Product Spec

> A shared to-do list between you and your AI coding tools — it knows who should do what, and when.

---

## What This Is

DevShift is a local tool for developers who pay for AI coding subscriptions and want every dollar working for them. You dump tasks into it — from your phone, Telegram, your laptop, wherever. It figures out which tasks an AI agent can handle autonomously and which ones need you. It schedules the agent work around your life using whichever AI coding tools you have, and when you come back, you see a clean summary of what changed.

It's not a CI/CD tool. It's not a task runner. It's a **collaboration layer between you and your AI coding tools** that makes sure none of you are sitting idle when there's work to do.

### Supported Providers (use one or many)
- **Claude Code** (Claude Max subscription — $20/$100/$200/mo)
- **Google Antigravity** (free for individuals, `agy` CLI)
- **Cursor** (Pro/Ultra subscription)
- More can be added via the plugin interface

If you have multiple subscriptions, DevShift routes tasks intelligently — complex feature work goes to your best provider, simple tasks go to whichever has free credits. If one provider hits a rate limit, it falls back to the next.

---

## How People Get It

- Public GitHub repo, MIT license
- Clone it, run `npx devshift`, answer a few questions, it's running
- No accounts, no cloud services, no API keys from us
- Works entirely on your machine with your existing AI subscriptions
- Simple landing page (GitHub Pages) with a screenshot and "Get Started" link
- Share on LinkedIn, Reddit, Twitter — if people want it, they clone it

---

## The Core Loop

```
You have an idea → dump it into DevShift → it figures out the rest

                    ┌──────────────┐
                    │  YOUR PHONE  │
                    │  or laptop   │
                    │              │
                    │  "Add dark   │
                    │   mode to    │
                    │   settings"  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ CLAUDE SHIFT │
                    │              │
                    │ Is this agent│──── Agent work ───→ Scheduled & executed
                    │ work or      │                     automatically
                    │ human work?  │
                    │              │──── Human work ───→ Surfaced to you
                    │              │                     when you're available
                    └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   CALENDAR   │
                    │   TIMELINE   │
                    │              │
                    │ Shows what's │
                    │ planned,     │
                    │ what's done, │
                    │ what needs   │
                    │ you          │
                    └──────────────┘
```

---

## Agent Work vs. Human Work

This is the most important concept in the product. Every task gets classified:

### Agent Work (AI handles autonomously)
- Writing and improving tests
- Fixing lint errors, formatting, import cleanup
- Updating documentation to match code
- Adding error handling to existing functions
- Dependency updates (non-breaking)
- Project scaffolding, boilerplate, CI configs
- Implementing features where the design is already decided
- Security audits, code cleanup
- Research tasks that produce a written summary

### Human Work (surfaced to you)
- Design decisions where taste matters
- Interactive debugging that needs poking around
- Architectural tradeoffs that need judgment
- Setting up credentials, accounts, third-party services
- Creative direction — naming, branding, choosing approaches
- Reviewing agent feature work and deciding if it's right

### Gray Zone (agent does heavy lifting, generates human tasks)
- "I built the notification system. You need to: add the SendGrid API key, decide opt-in vs opt-out, review the email templates I drafted."
- "I scaffolded the Supabase schema. Review it, then paste your connection string so I can deploy it."
- "I researched three caching strategies. Read my summary and pick one, then I'll implement it."

The agent should always generate specific, actionable human tasks — not vague "please review." Tell the human exactly what to look at, what to click, what to decide.

---

## The Calendar / Timeline View (Primary Interface)

This is the main screen. Not a Kanban board — a **timeline** showing:

```
┌─────────────────────────────────────────────────────────────┐
│  DevShift                          Credits: ████░░ 62%  │
│                                                             │
│  [I'm done for today]  [I'm off until ___]                  │
│                                                             │
│  ─── Today, March 23 ──────────────────────────────────────│
│                                                             │
│  9:00 AM   YOU: Active coding window starts                 │
│            Agent paused — 3 human tasks waiting for you     │
│                                                             │
│  ▸ Review: Dark mode PR (ProductA) — check settings page    │
│  ▸ Decision: Opt-in vs opt-out for notifications (ProductA) │
│  ▸ Setup: Paste Supabase connection string (ProductB)       │
│                                                             │
│  6:00 PM   Agent resumes ──────────────────────────────────│
│                                                             │
│  6:15 PM   ✓ Fix ESLint warnings (ProductA)         2m     │
│  6:32 PM   ✓ Add missing tests for auth (ProductA)  4m     │
│  6:48 PM   ✓ Update README examples (ProductB)      1m     │
│  7:05 PM   ● Working: Implement CSV export (ProductB)      │
│                                                             │
│  ─── Planned ──────────────────────────────────────────────│
│                                                             │
│  ~7:30 PM  ○ Add input validation to forms (ProductA)      │
│  ~8:00 PM  ○ Write API documentation (ProductB)            │
│  ~8:30 PM  ○ Research: best auth library (ProductC)        │
│                                                             │
│  ─── Tomorrow ─────────────────────────────────────────────│
│  Agent will resume at 6:00 PM (your off-hours)              │
│  5 tasks remaining in backlog                               │
│                                                             │
│  Estimated credit usage today: 15% of weekly                │
│  Remaining for your active coding: ~48% of weekly           │
│                                                             │
│  ───────────────────────────────────────────────────────── │
│  [+ Add task]                                               │
└─────────────────────────────────────────────────────────────┘
```

Key elements:
- **"I'm done for today" button** — single tap, agent starts working with full remaining daily allocation
- **"I'm off until ___" button** — date picker, agent plans work across the full period
- **Credit gauge** — shows weekly usage and what's reserved for your active coding
- **Human tasks** — prominent, at the top, with specific instructions on what to check
- **Agent activity** — completed tasks with durations, currently running task, planned tasks
- **Planned tasks** — reorderable, pausable, with estimated times

---

## Review Experience

When the agent completes work, you don't review raw code diffs on your phone. Instead:

### For each completed task, the agent provides:
1. **Plain English summary**: "Added try/catch blocks to 4 payment endpoints. Error messages now show user-friendly text instead of stack traces."
2. **What to check**: "Open the checkout page, try submitting with an empty card number. You should see 'Please enter a valid card number' instead of a server error."
3. **Rollback point**: Every batch of agent work is tagged in git so you can revert cleanly, like rolling back a Vercel deployment.
4. **Scope indicator**: "Changed 3 files in src/payments/. No database changes. No new dependencies."

### For visual/frontend changes specifically:
- The agent should note which pages/routes were affected
- Describe what visually changed
- If possible, capture a screenshot using headless browser and attach to the PR

### Cumulative changelog:
When you open the app after being away, you don't see 12 separate task cards. You see a grouped summary per project:
"Since you last checked in (14 hours ago): ProductA had 5 tasks completed (3 auto-merged, 2 need review). ProductB had 2 tasks completed (both auto-merged). Here's what changed and what to look for."

---

## Task Prioritization Logic

The agent should be smart about ordering:

### Priority 1: Quick autonomous wins
Tasks that are safe, fast, and don't need human review. Tests, docs, linting, formatting. These create immediate visible progress and use minimal credits. The agent should batch these and knock them all out first.

### Priority 2: Research and proposals
Produces useful output (docs, analysis) without any code risk. Good use of agent time because the human can review the thinking later at their own pace.

### Priority 3: Feature work (needs human review)
These take more credits AND require human attention afterward. Schedule these so the results are ready when the human is likely to be available — e.g., finish feature work by morning so the human can review during their active hours.

### Priority 4: Human-blocked tasks
Tasks where the agent has done its part and is waiting on a human decision, credential, or approval. These get surfaced prominently but don't consume agent time.

### Override: User-set deadlines or explicit priority
If the user marks something as urgent or sets a deadline, it jumps the queue regardless of tier.

---

## Per-Project Context

Each project is more than a repo path. It has:

```
Project: "My SaaS Dashboard"
├── Repo: /Users/you/code/my-saas (github: you/my-saas)
├── Context: "B2B analytics dashboard, Next.js + Postgres + Stripe"
├── CLAUDE.md: Auto-maintained project context for Claude Code
├── Status: Living summary of recent changes, current state, known issues
├── Backlog: Ordered list of tasks specific to this project
├── Preferences: "Don't touch payment module without approval"
│                "Always run tests after changes"
│                "Use Supabase for any new database needs"
└── Human tasks: Things waiting for the human (credentials, decisions, reviews)
```

The agent reads this context before starting any task on the project, so it has full awareness of what the project is, what matters, and what to avoid.

---

## New Product Creation Flow ("Full Bloom")

When you have a well-thought-out product idea (not just an incremental improvement):

1. **You write a spec** — can be loose, a paragraph or a detailed doc
2. **Agent plans with Opus** — creates a proper project plan, breaks it into phases, identifies what it can do vs. what needs you
3. **Agent scaffolds** — creates the repo, sets up project structure, CLAUDE.md, basic configs
4. **Agent generates the backlog** — creates all the tasks, properly ordered with dependencies
5. **Agent flags human-required setup** — "You need to: create a Supabase project, set up a Vercel account, register the domain"
6. **You do the human tasks** — mark them done in the dashboard, paste in credentials/URLs
7. **Agent builds** — works through the backlog, using subagents, reviewers, and proper coding practices
8. **You review at milestones** — not every commit, but at meaningful checkpoints

This is a higher-trust mode. The agent uses Opus for planning, subagents for exploration, and reviewer agents to check its own work before committing.

---

## Agent Coding Practices

The agent shouldn't just blindly run `claude -p`. For any meaningful task:

- **Use subagents** for exploration before making changes (read the codebase, understand context)
- **Use a reviewer pattern** — after making changes, spawn a review subagent to check for issues
- **Use context compaction** — keep token usage efficient with `/compact`
- **Atomic commits** — one logical change per commit, meaningful messages
- **Branch per task** — never commit directly to main
- **Run tests** — if the project has a test suite, run it after changes
- **Model selection** — Sonnet for Tier 1 (fast, cheap), Opus for Tier 2 features and planning, Sonnet for Tier 3 research

---

## Credit Management

### How it works:
- On setup, the tool detects your plan tier (Pro, Max 5x, Max 20x) by running `claude /status`
- Based on tier, it sets conservative default pacing
- It tracks approximate usage by counting task executions and their durations
- The credit gauge on the dashboard shows estimated weekly usage

### Smart pacing rules:
1. **Never start a task you can't finish** — estimate task duration from tier/complexity, don't start if it would overflow into human hours
2. **Reserve human hours** — carve out your configured active coding hours as untouchable
3. **Tier 1 tasks use Sonnet** — roughly 60% less credit-intensive than Opus
4. **Rate limit detection** — if Claude Code returns rate limit errors, exponential backoff (5min, 10min, 20min, 40min, max 2 hours)
5. **"I'm off" mode** — when user signals they're done, unlock reserved hours for agent use
6. **Conservative defaults by plan**:
   - Pro ($20): max 2-3 tasks per off-hours window
   - Max 5x ($100): max 5-8 tasks per off-hours window
   - Max 20x ($200): max 12-15 tasks per off-hours window
   - All configurable upward once user trusts the system

### What the user sees:
```
Weekly credits: ████████░░░░ 62% used
  Your coding:  ████████     (52%)
  Agent work:   ░░           (10%)
  Reserved:     ░░░░         (28% reserved for your remaining active hours)
  Available:    ░░           (10% available for agent tonight)
```

---

## Running Modes

### Option A: Your laptop (simplest)
- Install and run on your development machine
- Agent works when your laptop is open and you're not actively using Claude Code
- Good for: getting started, daily use, working alongside the agent

### Option B: Home server / always-on machine
- Install on a Mac Mini, old laptop, NAS, or any always-on computer
- Clone your repos there, authenticate Claude Code to your Max account
- Agent works 24/7 (during your configured off-hours)
- Good for: vacations, weekends, truly hands-off operation

### Option C: Cloud VM
- Spin up a small VPS ($5-10/mo), install Claude Code, authenticate to your Max account
- Good for: always-on without hardware at home
- Note: Claude Code uses your Max subscription regardless of which machine it runs on

The dashboard is a web app in all cases — access it from any device on your network, or set up a Cloudflare Tunnel for remote access from your phone.

---

## Tech Stack

- **Backend**: Node.js 20+, Express, better-sqlite3, node-cron
- **Frontend**: React (Vite), Tailwind CSS, deployed as PWA
- **Telegram Bot**: node-telegram-bot-api (optional, for quick task input + notifications)
- **Execution**: Provider plugin system (see below)
- **GitHub**: Octokit for PR creation and branch management
- **No TypeScript** in v1 — plain JS with JSDoc for speed
- **No external services** — everything runs locally, data in SQLite

### Provider Plugin Architecture

Each AI coding tool is a "provider" with a standard interface:

```javascript
// Every provider implements this interface:
class Provider {
  name          // "claude_code", "antigravity", "cursor"
  detect()      // → bool: is this tool installed?
  getPlanInfo() // → { tier, creditsRemaining, rateLimit }
  execute(task, project, options) // → { success, output, error }
}
```

**Built-in providers:**

| Provider | CLI Command | Auth | Best For |
|----------|-------------|------|----------|
| Claude Code | `claude -p "prompt"` | Max subscription (OAuth) | Complex features, research, Opus-level work |
| Google Antigravity | `agy --headless "prompt"` (or IDE API) | Free Google account | Tier 1 tasks, parallel agents, free credits |
| Cursor | Cursor CLI agent mode | Pro/Ultra subscription | General coding tasks |

**Provider routing logic:**
1. User configures which providers to use for which task tiers
2. Default: primary provider for everything, fallbacks for rate limits
3. Smart mode: route Tier 1 (simple) tasks to free providers (Antigravity), reserve paid credits (Claude Max) for Tier 2/3
4. If primary provider hits rate limit → fall back to next provider
5. User can override per-task: "use Opus for this one"

**Setup adds one step:**
"Which AI coding tools do you have?" → auto-detect installed tools, let user enable/configure

---

## Telegram Bot (Optional Input Channel)

The fastest way to add a task is to text it. The Telegram bot provides:

**Adding tasks:**
```
You: ProductA: add dark mode to settings
Bot: ✓ Added to ProductA backlog (Tier 2 — needs review)
     Agent will pick this up at 6:00 PM

You: urgent ProductB: fix the login bug before demo tomorrow
Bot: ✓ Added to ProductB backlog — URGENT, moved to top of queue
```

**Quick status:**
```
You: status
Bot: 🟢 Agent running — working on "Add tests for auth" (ProductA)
     Credits: 62% weekly remaining
     3 tasks completed today, 2 need your review
```

**Approvals:**
```
Bot: PR #47 ready for review: "Dark mode for settings page"
     Changed 4 files. Check: open Settings, toggle dark mode, verify all text is readable.
     [Approve] [View PR] [Skip]
You: [taps Approve]
Bot: ✓ Merged PR #47
```

**"I'm done" shortcut:**
```
You: done for today
Bot: ✓ Agent unlocked — will work through 5 backlog tasks tonight.
     Estimated: 3 auto-merge, 2 will need your review tomorrow.

You: off until monday
Bot: ✓ Vacation mode until Monday 9 AM.
     Agent will work through the full backlog using all available credits.
```

Setup: User creates a Telegram bot via @BotFather (takes 30 seconds), pastes the token during DevShift setup.

---

## Setup Experience (Under 5 Minutes)

```bash
git clone https://github.com/YOUR_USERNAME/devshift.git
cd devshift
npx devshift
```

The setup wizard:
1. "Which AI coding tools do you have?" → auto-detects Claude Code, Antigravity, Cursor
2. For each detected tool: confirms authentication, detects plan tier
3. "What timezone are you in?" → auto-detect, confirm
4. "When do you usually code?" → suggest 9am-6pm weekdays, let them adjust
5. "Add a project?" → browse to repo folder, auto-detect GitHub remote
6. "Add another?" → repeat or skip
7. "Got a GitHub token for PR creation?" → link to create one, paste it in
8. "Want Telegram notifications?" → optional, link to create bot, paste token
9. Done. Dashboard opens at localhost:3847.

No .env files. No manual configuration. Everything stored in SQLite.

---

## Dashboard Design

### Aesthetic: "Mission Control"
Dark theme. Data-dense. Monospace for data, clean sans-serif for UI. Electric blue accents on near-black surfaces. Not playful, not corporate — technical and purposeful.

### Color System
```
Background:  #08080d (primary), #111118 (cards), #1a1a24 (hover)
Text:        #e4e4ed (primary), #8888a0 (muted), #55556a (very muted)
Borders:     #2a2a3a
Accents:     #3b82f6 (blue/primary), #22c55e (success), #eab308 (warning), 
             #ef4444 (error), #a855f7 (research/purple)
Fonts:       DM Sans (UI), JetBrains Mono (data/status)
```

### Mobile Layout
- Single column
- Timeline view as default (not Kanban)
- Bottom tab bar: Timeline | Projects | Settings
- Floating "+" button for quick task add
- "I'm done for today" prominent at top
- Agent status bar always visible

### Desktop Layout
- Narrow sidebar navigation
- Main content: timeline view
- Right panel: project details / task detail (optional)

### PWA
- manifest.json with app name, icons, standalone display
- Service worker for offline shell caching
- Installable on phone home screen
- Simple SVG icon (the letter "S" in a terminal-style box)

---

## Landing Page (GitHub Pages)

Single page, clean, dark theme matching the dashboard aesthetic:

```
DevShift
Your AI dev team's night shift.

[Screenshot of the timeline dashboard]

Queue tasks from your phone or Telegram.
Your AI coding tools work while you sleep.
Wake up to progress.

Works with Claude Code, Google Antigravity, Cursor — or all of them.

→ Get Started (link to GitHub repo)

---

Runs locally. No accounts. MIT License.
```

That's it. No pricing, no signup, no feature comparison tables. Just: here's what it does, here's a screenshot, here's how to get it.

---

## Database Schema

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  github_remote TEXT,
  context TEXT,                    -- project description for Claude
  preferences TEXT,                -- JSON: per-project rules
  status_summary TEXT,             -- auto-maintained current state
  priority INTEGER DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT DEFAULT 'agent',  -- 'agent', 'human', 'blocked'
  tier INTEGER DEFAULT 2,         -- 1=auto, 2=needs review, 3=research
  status TEXT DEFAULT 'backlog',  -- backlog, queued, in_progress, needs_review, 
                                  -- waiting_human, done, failed
  priority INTEGER DEFAULT 5,
  deadline TEXT,                   -- optional deadline
  pre_approved INTEGER DEFAULT 0, -- 1=auto-merge even for Tier 2
  branch_name TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  result_summary TEXT,             -- what Claude did (plain English)
  review_instructions TEXT,        -- what the human should check
  execution_log TEXT,
  model TEXT DEFAULT 'sonnet',
  provider TEXT DEFAULT 'claude_code', -- which provider to use
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  parent_task_id TEXT              -- for human sub-tasks generated by agent
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,             -- 'claude_code', 'antigravity', 'cursor'
  name TEXT NOT NULL,              -- Display name
  enabled INTEGER DEFAULT 1,
  cli_command TEXT,                -- e.g. 'claude', 'agy'
  auth_status TEXT DEFAULT 'unknown', -- 'authenticated', 'expired', 'unknown'
  plan_tier TEXT,                  -- provider-specific tier
  use_for_tiers TEXT DEFAULT '1,2,3', -- which task tiers to use this for
  priority INTEGER DEFAULT 1,     -- 1=primary, 2=fallback, etc.
  rate_limited_until TEXT,         -- timestamp if currently rate limited
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE schedule (
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

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  project_id TEXT REFERENCES projects(id),
  started_at TEXT,
  completed_at TEXT,
  status TEXT,            -- running, completed, failed, rate_limited
  output TEXT,
  provider TEXT,              -- which provider executed this
  model TEXT,
  estimated_credits REAL, -- rough estimate
  error TEXT
);

CREATE TABLE changelog (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  timestamp TEXT DEFAULT (datetime('now')),
  summary TEXT,           -- cumulative changelog entry
  tasks_completed TEXT,   -- JSON array of task IDs
  rollback_tag TEXT       -- git tag for rollback point
);
```

---

## API Endpoints

```
# Projects
GET    /api/projects
POST   /api/projects
PATCH  /api/projects/:id
DELETE /api/projects/:id

# Tasks
GET    /api/tasks                    ?project_id=X&status=Y&task_type=Z
POST   /api/tasks
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/execute        # manual trigger

# Schedule
GET    /api/schedule
PATCH  /api/schedule
POST   /api/schedule/off-today       # "I'm done for today" 
POST   /api/schedule/off-until       # "I'm off until [date]"
POST   /api/schedule/im-back         # "I'm back, pause agent"

# Timeline
GET    /api/timeline                 # unified view: completed + planned + human tasks
GET    /api/timeline/digest          # summary since last check-in

# Agent
GET    /api/agent/status
POST   /api/agent/start
POST   /api/agent/pause
POST   /api/agent/resume

# Changelog
GET    /api/changelog                ?project_id=X
POST   /api/changelog/:id/rollback  # revert to a rollback point
```

---

## Build Order

### Phase 1: Core (get it running)
1. Project init (package.json, Express, SQLite, folder structure)
2. Database schema + migrations (including providers table)
3. Project CRUD API
4. Task CRUD API with auto-classification (agent vs human, tier assignment)
5. Schedule config API
6. Provider registry (detect installed tools, store config)

### Phase 2: Execution Engine
7. Provider plugin interface (standard class that all providers implement)
8. Claude Code provider (spawn `claude -p`, capture output, detect rate limits)
9. Google Antigravity provider (spawn `agy` headless, capture output)
10. Cursor provider (agent mode CLI, capture output) — can be stubbed if CLI docs unclear
11. Provider routing logic (pick provider based on task tier + availability + rate limits)
12. Git branch management (create branch, commit, push)
13. GitHub PR creation via Octokit
14. Task execution pipeline (classify → pick provider → execute → commit → PR or merge)
15. Rate limit detection + exponential backoff + provider fallback

### Phase 3: Scheduler
16. Cron-based scheduler that checks every minute
17. Off-hours detection (compare current time to schedule)
18. Task selection logic (priority ordering: Tier 1 first, then Tier 3, then Tier 2)
19. "I'm done for today" / "I'm off until" handlers
20. Credit usage tracking (approximate, per provider)
21. Smart provider routing (free providers for simple tasks, paid for complex)

### Phase 4: Dashboard
22. Vite + React + Tailwind setup with API proxy
23. Timeline view (the main screen — see timeline spec above)
24. Task input component (natural language + project selector)
25. Agent status bar + control buttons + credit gauge
26. "I'm done for today" / "I'm off until" buttons (prominent)
27. Schedule configuration screen
28. Project management screen
29. Provider configuration screen (enable/disable, set routing preferences)
30. PWA setup (manifest, service worker, mobile meta tags)
31. Design polish (Mission Control aesthetic)

### Phase 5: Telegram Bot
32. Telegram bot setup (node-telegram-bot-api)
33. Task input via Telegram messages
34. Status queries ("status", "what's running")
35. "done for today" / "off until monday" commands
36. Notification sending (task completed, PR ready for review, errors)
37. Quick approve/reject for PRs via inline buttons

### Phase 6: Polish & Ship
38. Setup wizard (`npx devshift`) — interactive, detects all providers
39. Cumulative changelog generation
40. Rollback support (git tags per work batch)
41. README for GitHub
42. Landing page (single HTML file for GitHub Pages)
43. End-to-end test on a real repo with at least 2 providers

---

## File Structure

```
devshift/
├── CLAUDE.md                      # Project context for Claude Code
├── README.md
├── package.json
├── bin/
│   └── devshift.js                # CLI entry point (npx devshift)
├── src/
│   ├── server.js                  # Express app
│   ├── db.js                      # SQLite setup
│   ├── routes/
│   │   ├── projects.js
│   │   ├── tasks.js
│   │   ├── schedule.js
│   │   ├── agent.js
│   │   ├── providers.js           # Provider config routes
│   │   ├── timeline.js
│   │   └── changelog.js
│   ├── providers/                 # AI coding tool integrations
│   │   ├── base.js                # Base provider interface
│   │   ├── claude-code.js         # Claude Code provider
│   │   ├── antigravity.js         # Google Antigravity provider
│   │   ├── cursor.js              # Cursor provider
│   │   └── index.js               # Provider registry + routing
│   ├── services/
│   │   ├── scheduler.js           # Core scheduling daemon
│   │   ├── executor.js            # Provider-agnostic execution orchestrator
│   │   ├── github.js              # Octokit integration
│   │   ├── classifier.js          # Agent/human task classification
│   │   ├── planner.js             # Credit-aware task planning + provider routing
│   │   ├── digest.js              # Changelog + digest generation
│   │   └── telegram.js            # Telegram bot integration
│   └── utils/
│       ├── logger.js
│       ├── config.js
│       └── git.js                 # Git helper functions
├── dashboard/
│   ├── index.html
│   ├── vite.config.js
│   ├── public/
│   │   ├── manifest.json
│   │   ├── sw.js
│   │   └── icon.svg
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── pages/
│       │   ├── Timeline.jsx       # Main view
│       │   ├── Projects.jsx       # Project management
│       │   └── Settings.jsx       # Schedule + providers + preferences
│       ├── components/
│       │   ├── TaskInput.jsx
│       │   ├── TimelineEntry.jsx
│       │   ├── AgentStatusBar.jsx
│       │   ├── CreditGauge.jsx
│       │   ├── HumanTaskCard.jsx
│       │   ├── ProjectCard.jsx
│       │   └── ProviderStatus.jsx # Shows status of each provider
│       └── hooks/
│           └── useApi.js
├── landing/
│   └── index.html                 # GitHub Pages landing page
├── scripts/
│   └── setup.js                   # First-run setup wizard
└── data/                          # Auto-created
    └── devshift.db
```

---

## How to Tell Your Agent to Build This

Create a new GitHub repo called `devshift`. Copy this entire spec into the repo as `SPEC.md`. Then open Claude Code in the repo directory and say:

> Read SPEC.md. This is the complete product spec for DevShift. Build it from Phase 1 through Phase 6, in order. After completing each numbered task, test it before moving to the next. When you finish a phase, summarize what's working before starting the next phase. Use subagents for exploration, reviewer patterns to check your own work, and atomic git commits. Start now with Phase 1, Task 1.

The agent should be able to work through this autonomously. When it finishes, you'll have a working product you can use immediately and share on LinkedIn.

---

*Built for builders who have more ideas than hours.*
