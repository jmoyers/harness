#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, './harness.ts');
const child = spawn(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.once('exit', (code, signal) => {
  if (code !== null) {
    process.exit(code);
    return;
  }
  if (signal === 'SIGINT') {
    process.exit(130);
    return;
  }
  if (signal === 'SIGTERM') {
    process.exit(143);
    return;
  }
  process.exit(1);
});
