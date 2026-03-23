#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0] || 'start';

const ROOT = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, 'data', '.devshift.pid');

function ensureDataDir() {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getRunningPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isRunning(pid)) return pid;
    fs.unlinkSync(PID_FILE);
  } catch { /* no pid file */ }
  return null;
}

switch (command) {
  case 'start': {
    const existing = getRunningPid();
    if (existing) {
      console.log(`DevShift is already running (PID ${existing})`);
      console.log(`Dashboard: http://localhost:3847`);
      process.exit(0);
    }

    ensureDataDir();

    // Build dashboard if not built
    const distPath = path.join(ROOT, 'dashboard', 'dist', 'index.html');
    if (!fs.existsSync(distPath)) {
      console.log('Building dashboard...');
      try {
        execSync('npx vite build', { cwd: path.join(ROOT, 'dashboard'), stdio: 'inherit' });
      } catch {
        console.error('Dashboard build failed — continuing with API only');
      }
    }

    // Start as daemon
    const logFile = path.join(ROOT, 'data', 'devshift.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn('node', [path.join(ROOT, 'src', 'server.js')], {
      detached: true,
      stdio: ['ignore', out, out],
      cwd: ROOT,
    });

    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    console.log(`DevShift started (PID ${child.pid})`);
    console.log(`Dashboard: http://localhost:3847`);
    console.log(`Logs: ${logFile}`);
    process.exit(0);
  }

  case 'stop': {
    const pid = getRunningPid();
    if (!pid) {
      console.log('DevShift is not running');
      process.exit(0);
    }
    process.kill(pid, 'SIGTERM');
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    console.log(`DevShift stopped (PID ${pid})`);
    process.exit(0);
  }

  case 'restart': {
    const pid = getRunningPid();
    if (pid) {
      process.kill(pid, 'SIGTERM');
      try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
      console.log(`Stopped PID ${pid}`);
      // Wait a moment for port to free
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      wait(1000).then(() => {
        execSync(`node ${__filename} start`, { stdio: 'inherit' });
      });
    } else {
      execSync(`node ${__filename} start`, { stdio: 'inherit' });
    }
    break;
  }

  case 'status': {
    const pid = getRunningPid();
    if (pid) {
      console.log(`DevShift is running (PID ${pid})`);
      console.log(`Dashboard: http://localhost:3847`);
    } else {
      console.log('DevShift is not running');
    }
    process.exit(0);
  }

  case 'logs': {
    const logFile = path.join(ROOT, 'data', 'devshift.log');
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf-8').split('\n');
      console.log(lines.slice(-50).join('\n'));
    } else {
      console.log('No logs found');
    }
    process.exit(0);
  }

  case 'setup': {
    require('../scripts/setup');
    break;
  }

  default:
    console.log(`Usage: devshift [start|stop|restart|status|logs|setup]`);
    process.exit(1);
}
