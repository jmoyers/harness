import { startEventStoreMaintenanceDaemon } from '../src/storage/event-store-maintenance-daemon.ts';
import type { StorageLifecyclePolicy } from '../src/storage/storage-lifecycle-core.ts';

function usage(): never {
  throw new Error(
    'usage: bun scripts/event-store-maintenance-daemon.ts --store-path <path> --policy-json <json> --parent-pid <pid>',
  );
}

function readArgValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInt(value: string, label: string): number {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return numeric;
}

function parseArgs(argv: readonly string[]): {
  storePath: string;
  policyJson: string;
  parentPid: number;
} {
  let storePath: string | null = null;
  let policyJson: string | null = null;
  let parentPid: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--store-path') {
      storePath = readArgValue(argv, index, '--store-path');
      index += 1;
      continue;
    }
    if (arg === '--policy-json') {
      policyJson = readArgValue(argv, index, '--policy-json');
      index += 1;
      continue;
    }
    if (arg === '--parent-pid') {
      parentPid = parsePositiveInt(readArgValue(argv, index, '--parent-pid'), '--parent-pid');
      index += 1;
      continue;
    }
    usage();
  }
  if (storePath === null || policyJson === null || parentPid === null) {
    usage();
  }
  return {
    storePath,
    policyJson,
    parentPid,
  };
}

function run(): void {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const parsedPolicy = JSON.parse(parsedArgs.policyJson) as Partial<StorageLifecyclePolicy>;
  const daemon = startEventStoreMaintenanceDaemon({
    storePath: parsedArgs.storePath,
    policy: parsedPolicy,
    parentPid: parsedArgs.parentPid,
    emitMessage: (message) => {
      process.stdout.write(`${JSON.stringify(message)}\n`);
    },
  });

  const shutdown = () => {
    daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

run();
