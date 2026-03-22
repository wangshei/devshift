#!/usr/bin/env node

const readline = require('readline');
const { execSync } = require('child_process');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║      DevShift Setup Wizard       ║');
  console.log('  ╚══════════════════════════════════╝\n');

  // Initialize DB
  const { migrate, getDb } = require('../src/db');
  migrate();
  const db = getDb();

  // Step 1: Detect providers
  console.log('  Detecting AI coding tools...\n');
  const { detectProviders } = require('../src/providers');
  const providers = detectProviders();
  for (const p of providers) {
    const icon = p.installed ? '✓' : '✗';
    console.log(`    ${icon} ${p.name} ${p.installed ? '(found)' : '(not found)'}`);
  }
  console.log('');

  // Step 2: Timezone
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = await ask(`  Timezone [${detectedTz}]: `) || detectedTz;
  db.prepare('UPDATE schedule SET timezone = ? WHERE id = 1').run(tz);

  // Step 3: Active hours
  const startHour = await ask('  When do you usually start coding? [09:00]: ') || '09:00';
  const endHour = await ask('  When do you usually stop? [18:00]: ') || '18:00';
  db.prepare('UPDATE schedule SET active_hours_start = ?, active_hours_end = ? WHERE id = 1')
    .run(startHour, endHour);

  // Step 4: Add projects
  console.log('\n  Add your projects:\n');
  let addMore = true;
  while (addMore) {
    const repoPath = await ask('  Repo path (or Enter to skip): ');
    if (!repoPath) break;

    const name = await ask('  Project name: ');
    if (!name) continue;

    let githubRemote = '';
    try {
      githubRemote = execSync('git remote get-url origin', {
        cwd: repoPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
      console.log(`    Detected remote: ${githubRemote}`);
    } catch { /* no remote */ }

    const context = await ask('  Brief project description (for AI context): ') || '';

    const { v4: uuid } = require('uuid');
    db.prepare(`INSERT INTO projects (id, name, repo_path, github_remote, context) VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), name, repoPath, githubRemote || null, context || null);
    console.log(`    ✓ Added ${name}\n`);
  }

  // Step 5: Telegram (optional)
  const wantTelegram = await ask('\n  Set up Telegram notifications? (y/N): ');
  if (wantTelegram.toLowerCase() === 'y') {
    console.log('    1. Open Telegram, search for @BotFather');
    console.log('    2. Send /newbot and follow the prompts');
    console.log('    3. Copy the token it gives you\n');
    const token = await ask('  Paste your bot token: ');
    if (token.trim()) {
      db.prepare('UPDATE schedule SET telegram_bot_token = ? WHERE id = 1').run(token.trim());
      console.log('    ✓ Token saved. Send any message to your bot to register.\n');
    }
  }

  console.log('\n  ✓ Setup complete!\n');
  console.log('  Run:  npm start');
  console.log('  Open: http://localhost:3847\n');

  const { close } = require('../src/db');
  close();
  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
