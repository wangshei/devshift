const { v4: uuid } = require('uuid');
const db = require('../src/db'); db.migrate(); const d = db.getDb();
const pid = '0b7421af-7c28-4e6e-ad0e-469528d84e43';

const id = uuid();
d.prepare(`INSERT INTO tasks (id, project_id, title, description, tier, priority, task_type, status) VALUES (?, ?, ?, ?, ?, ?, 'agent', 'backlog')`).run(
  id, pid,
  'Add GPT and Gemini as fallback providers for when Claude credits run out',
  `## What to build
Add OpenAI GPT and Google Gemini as provider plugins so DevShift can auto-switch when Claude is rate limited or out of credits.

## Architecture
Create two new provider files extending BaseProvider:

### src/providers/openai.js
- detect(): check for OPENAI_API_KEY env var
- execute(): use OpenAI API via fetch (not CLI)
- Model: gpt-4o for complex, gpt-4o-mini for simple

### src/providers/gemini.js
- detect(): check for GEMINI_API_KEY env var
- execute(): use Gemini API via fetch
- Model: gemini-2.0-flash (free tier generous)

### Update src/providers/index.js
- Add to KNOWN_PROVIDERS
- pickBestProvider: when Claude is rate limited, try GPT/Gemini
- For Think mode chat: prefer Gemini (free) over Claude

### Settings UI
- API key inputs for GPT and Gemini in Settings page

## Key constraint
These do prompt-response only (no file editing). Good for:
- Think mode chat, PM decomposition, code review, Smart Mode
NOT for: actual coding (needs Claude Code)

## Verification
Run node -e "require('./src/providers/openai')"`,
  2, 3
);
console.log('Queued: GPT/Gemini provider task');
