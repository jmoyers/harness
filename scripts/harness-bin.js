#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'];

function readPackageManager(packageJsonPath) {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (typeof parsed.packageManager === 'string') {
      return parsed.packageManager;
    }
  } catch {
    return null;
  }
  return null;
}

function findLegacyLockfiles(cwd) {
  return LEGACY_LOCKFILES.filter((file) => existsSync(resolve(cwd, file)));
}

function maybePrintBunMigrationHint() {
  if (process.env.HARNESS_SUPPRESS_BUN_MIGRATION_HINT === '1') {
    return;
  }
  const cwd = process.cwd();
  const packageJsonPath = resolve(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return;
  }
  const packageManager = readPackageManager(packageJsonPath);
  if (packageManager === null || packageManager.startsWith('bun@') === false) {
    return;
  }
  const legacyLockfiles = findLegacyLockfiles(cwd);
  if (legacyLockfiles.length === 0) {
    return;
  }
  const lockfileList = legacyLockfiles.map((entry) => `  - ${entry}`).join('\n');
  process.stderr.write(
    `[harness] legacy package-manager lockfiles detected in ${cwd}:\n${lockfileList}\n[harness] run: bun run migrate:bun\n`
  );
}

maybePrintBunMigrationHint();

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
