#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, './harness.ts');
const runtimeArgs = [scriptPath, ...process.argv.slice(2)];
const child = spawn(process.execPath, runtimeArgs, {
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
