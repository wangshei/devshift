# DevShift

**Your AI coding tools work while you sleep.**

You already pay for AI coding subscriptions — Claude Code, Cursor, Antigravity. But you only use them 8 hours a day. DevShift runs those same tools on your projects during off-hours, burning through your task backlog overnight.

Wake up to completed PRs, fixed bugs, and new features — all using credits you were already paying for.

## How it works

1. **Add your projects** — point DevShift at your local codebases
2. **Add tasks** — describe what you need in plain English ("fix the login bug", "add input validation", "write tests for the auth module")
3. **Turn on auto-pilot** — DevShift picks tasks from your backlog, runs them through your AI tools, and commits the results
4. **Review the output** — approve PRs, merge changes, or reject and retry

The agent automatically rotates across all your projects, picking the highest-priority work first. When the backlog is empty, it proactively analyzes your code for improvements.

## Features

- **Multi-project** — manage multiple codebases from one dashboard
- **Multi-provider** — uses Claude Code, Cursor, and Google Antigravity (whatever you have installed)
- **Smart scheduling** — only runs during your off-hours so it never conflicts with your coding
- **Auto-pilot mode** — set it and forget it, the agent works whenever there are tasks
- **Code review** — creates branches and PRs for non-trivial changes so you stay in control
- **Task classification** — automatically categorizes tasks by complexity (auto-merge simple fixes, review features)
- **Credit-aware** — tracks usage so it doesn't blow through your subscription limits
- **Light & dark mode** — toggle in the bottom-right corner
- **Fully local** — everything runs on your machine, no external services or accounts needed

## Quick start

```bash
# Clone the repo
git clone https://github.com/user/devshift.git
cd devshift

# Install dependencies
npm install

# Build the dashboard
npm run build

# Start the server
npm start
```

Then open [http://localhost:3847](http://localhost:3847) in your browser. The setup wizard will walk you through connecting your AI tools and adding projects.

### Requirements

- **Node.js 20+**
- At least one AI coding tool installed:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI)
  - [Google Antigravity](https://idx.google.com/) (`agy` CLI)
  - [Cursor](https://cursor.sh/) (`cursor` CLI)
- macOS (Linux support planned)

## Architecture

```
devshift/
├── src/
│   ├── server.js          # Express app (port 3847)
│   ├── db.js              # SQLite database + migrations
│   ├── routes/            # API endpoints
│   ├── services/
│   │   ├── scheduler.js   # Cron job — picks and runs tasks every minute
│   │   ├── executor.js    # Runs tasks via AI providers, manages git branches
│   │   ├── planner.js     # Credit tracking and task limits
│   │   └── smart-mode.js  # Proactive code improvements when backlog is empty
│   └── providers/         # AI tool integrations (Claude, Antigravity, Cursor)
├── dashboard/             # React frontend (Vite + Tailwind v4)
│   └── src/
│       ├── pages/         # Dashboard, ProjectFeed, Settings, Setup
│       └── components/    # Sidebar, TaskInput, ThemeToggle, etc.
└── data/                  # SQLite database + execution logs (gitignored)
```

### How the scheduler works

Every minute, the scheduler:

1. Checks if it's off-hours (or auto-pilot is on)
2. Picks the highest-priority task across all projects
3. Creates a git branch, runs the AI tool, commits changes
4. For simple tasks: auto-merges. For complex tasks: creates a PR for review
5. Moves to the next task (up to 3 per tick, configurable daily limit)

When the backlog is empty, it switches to **Smart Mode** — analyzing your projects for potential improvements (test coverage, code quality, security, documentation) and creating tasks automatically.

## Configuration

### Schedule

Set your coding hours in the dashboard Settings page. The agent runs outside these hours. Or enable **auto-pilot** from the home screen to let it run whenever tasks are available.

### Task limits

By default, the agent runs up to 6 tasks per day. Adjust in Settings under "Max tasks per window."

### Credit reserve

Reserve a percentage of your AI credits for your own coding. The agent won't exceed the remaining budget. Default: 30% reserved for you.

## API

The server exposes a REST API at `http://localhost:3847/api`. Key endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/projects` | List all projects |
| `POST /api/projects/from-path` | Add a project from a directory path |
| `POST /api/tasks` | Create a new task |
| `GET /api/timeline/dashboard` | Dashboard data (all projects + status) |
| `GET /api/schedule` | Current schedule configuration |
| `PATCH /api/schedule` | Update schedule (always_on, hours, etc.) |
| `GET /api/agent/status` | Agent status (running, paused, current task) |

## Stack

- **Backend**: Node.js, Express, better-sqlite3, node-cron
- **Frontend**: React (Vite), Tailwind CSS v4, PWA-ready
- **Database**: SQLite (zero config, all data local)
- **No TypeScript** — plain JS with JSDoc

## License

MIT
