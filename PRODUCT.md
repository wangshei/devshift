# DevShift — Product Vision

## What it is
A product operating system for developers. Not just a task runner — a workspace where humans brainstorm with AI, AI executes autonomously, tests outcomes, and iterates. DevShift manages the full lifecycle: product goals → features → tasks → execution → review → learning.

## Core problem it solves
Working on multiple features across multiple projects but losing track of:
- Where each feature is and why it's performing the way it is
- The assumptions behind each feature when you've already moved to the next
- What was done vs what needs to be done
- What the agent did while you were away

## Design principles

### 1. Feature-centric, not task-centric
The user sees features with progress bars, not raw task lists. Implementation details (task titles, file paths, function names) are hidden by default. The default view answers "how far along is each feature?" not "what commits were made."

### 2. Less context switching
User can clearly know what stage each product is at. The home screen shows all projects with status, next steps, and unread PM reports. No need to dig into each project to understand what's happening.

### 3. The system proposes work, not just the human
Smart Mode analyzes code and proposes improvements. The PM agent reports what needs attention. Ideas get promoted to features. The human steers, the system generates. It should be clear what needs to be worked on.

### 4. First-principle thinking, visually laid out
Product Map shows: problems → goals → features → tasks as a visual tree. Each node shows progress, assumptions, status. You can see the "why" behind every task.

### 5. Great idea dump
Feature ideas can be created as tickets, managed in the next sprint. The system understands priority and how different work relates.

### 6. Seamless human-agent collaboration
- Human works inside DevShift with same quality as raw Claude Code
- Agent understands human work and continues seamlessly
- "Work on this" opens Claude session, "Hand off" passes it to agent
- Chat panel for brainstorming that directly becomes action
- Like a combination of Claude Desktop and Claude Code — brainstorming taken into account when building

### 7. Self-improving
- Everything done becomes information for what to improve next
- Agent learns from failures, retries, rejections, and comments
- Working memory (48h, always loaded) vs long-term memory (archived, searchable)
- Can propose and apply changes to its own codebase

### 8. Multi-agent as a team
- Each agent has a name, role, and profile (PM, Engineer, Reviewer)
- Agent activity visible as conversation threads (like Slack channels)
- PM reports to the human like a teammate — status updates, suggestions
- Future: marketing agent, design review agent, community feedback agent

## UX vision

### Navigation
- **Home** — command center. PM inbox, project status cards, auto-pilot toggle
- **Project** — feature progress view with goals, progress bars, ideas
- **My Work** — what needs your attention, active sessions, recent completions
- **Chat** — primary workspace for brainstorming → action (slide-in panel)
- **Timeline** — chronological cross-project activity feed
- **Settings** — schedule, providers, memory limits

### The experience should feel like
- **Notion** — documents, databases, and agents all connected in one place
- **Linear** — clean, fast, keyboard-driven task management
- **Slack** — agents as team members with profiles and work threads
- **Claude Desktop** — brainstorming directly feeds into execution

### What NOT to show
- Raw function names or file paths in the default view
- Implementation-level task titles ("Add estimateCostUsd() to planner.js")
- 100 subtasks requiring individual approval
- Developer jargon in status labels

### What TO show
- Feature names and progress bars
- "What's happening" summaries in plain English
- PM agent reports written conversationally
- Clear actions: "Review", "Approve", "Chat", "Work on this"
- Cost and time at the feature level, not task level

## Technical architecture
- Backend: Node.js, Express, SQLite (better-sqlite3), node-cron
- Frontend: React (Vite), Tailwind CSS v4
- AI: Claude Code CLI (`claude -p`), multi-turn via `--resume`, streaming via `--output-format stream-json`
- No TypeScript — plain JS with JSDoc
- All data local — no external services
- Provider plugin pattern (Claude Code, Antigravity, Cursor)

## Data model hierarchy
```
Product (project)
  └── Goals (what success looks like)
       └── Features (what we're building)
            └── Tasks (implementation steps)
                 └── Subtasks (decomposed by PM)
```

## Key user flows
1. **Morning check-in**: Open home → see PM reports → review agent work → approve/chat/adjust
2. **Add work**: Type idea → PM decomposes if vague → agent executes → verify
3. **Brainstorm**: Open chat → talk to Claude → push decisions to agent as tasks
4. **Focused session**: Click "Work on this" → code with Claude → hand off when done
5. **Evening**: Turn on auto-pilot → agent works overnight → review in morning
