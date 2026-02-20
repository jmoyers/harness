import { execute } from '@oclif/core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlobalCliOptions } from './harness-runtime.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const ROOT_HELP_TOKENS = new Set(['--help', '-h', '--version', 'help']);
const TOP_LEVEL_COMMANDS = new Set([
  'client',
  'gateway',
  'profile',
  'status-timeline',
  'render-trace',
  'auth',
  'update',
  'upgrade',
  'cursor-hooks',
  'nim',
  'animate',
]);

function normalizeHarnessArgs(rawArgv: readonly string[]): string[] {
  const parsedGlobals = parseGlobalCliOptions(rawArgv);
  let argv = [...parsedGlobals.argv];

  if (argv.length === 0) {
    argv = ['client'];
  } else if (!ROOT_HELP_TOKENS.has(argv[0]!) && !TOP_LEVEL_COMMANDS.has(argv[0]!)) {
    argv = ['client', ...argv];
  }

  if (parsedGlobals.sessionName !== null && argv.length > 0 && !ROOT_HELP_TOKENS.has(argv[0]!)) {
    argv = [argv[0]!, '--session', parsedGlobals.sessionName, ...argv.slice(1)];
  }

  return argv;
}

async function main(): Promise<void> {
  await execute({
    args: normalizeHarnessArgs(process.argv.slice(2)),
    dir: PROJECT_ROOT,
  });
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(
    `harness fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
