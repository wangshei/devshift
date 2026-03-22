#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes('--setup') || args.includes('setup')) {
  require('../scripts/setup');
} else {
  require('../src/server');
}
