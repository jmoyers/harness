import { mkdtempSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

interface ShardConfig {
  name: string;
  files: string[];
  estimatedCost: number;
}

const workspaceRoot = process.cwd();
const testRoot = resolve(workspaceRoot, 'test');

const isolatedShardFiles = [
  {
    name: 'mux-startup-integration',
    files: ['test/codex-live-mux-startup.integration.test.ts'],
  },
  {
    name: 'harness-cli',
    files: ['test/harness-cli.test.ts'],
  },
  {
    name: 'pty-and-live-session',
    files: ['test/pty_host.test.ts', 'test/codex-live-session.test.ts'],
  },
] as const;

const knownCostWeights = new Map<string, number>([
  ['test/codex-live-mux-startup.integration.test.ts', 16_000],
  ['test/harness-cli.test.ts', 7_000],
  ['test/pty_host.test.ts', 4_000],
  ['test/codex-live-session.test.ts', 1_000],
]);

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, '-');
}

function cloneStringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    if (typeof rawValue === 'string') {
      env[key] = rawValue;
    }
  }
  return env;
}

function createShardEnv(shardName: string): Record<string, string> {
  const shardHome = mkdtempSync(join(tmpdir(), `harness-test-${sanitizeLabel(shardName)}-`));
  const shardConfigHome = join(shardHome, '.config');
  mkdirSync(shardConfigHome, { recursive: true });
  const env = cloneStringEnv(process.env);
  env.HOME = shardHome;
  env.XDG_CONFIG_HOME = shardConfigHome;
  return env;
}

function collectTestFiles(rootDirectory: string): string[] {
  const files: string[] = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.test.ts')) {
        continue;
      }
      files.push(relative(workspaceRoot, absolutePath).replaceAll('\\', '/'));
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function estimateFileCost(filePath: string): number {
  const knownCost = knownCostWeights.get(filePath);
  if (knownCost !== undefined) {
    return knownCost;
  }
  const absolutePath = resolve(workspaceRoot, filePath);
  const fileSizeBytes = statSync(absolutePath).size;
  return Math.max(1, Math.ceil(fileSizeBytes / 128));
}

function resolveRemainderShardCount(): number {
  const parsed = Number.parseInt(process.env.HARNESS_TEST_REMAINDER_SHARDS ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 3;
  }
  return Math.min(parsed, 8);
}

function buildShards(allFiles: readonly string[]): ShardConfig[] {
  const allFileSet = new Set(allFiles);
  const assigned = new Set<string>();
  const shards: ShardConfig[] = [];

  for (const shard of isolatedShardFiles) {
    for (const filePath of shard.files) {
      if (!allFileSet.has(filePath)) {
        throw new Error(`missing isolated shard file: ${filePath}`);
      }
      if (assigned.has(filePath)) {
        throw new Error(`duplicate test file assignment: ${filePath}`);
      }
      assigned.add(filePath);
    }
    shards.push({
      name: shard.name,
      files: [...shard.files],
      estimatedCost: shard.files.reduce((sum, filePath) => sum + estimateFileCost(filePath), 0),
    });
  }

  const remainderFiles = allFiles.filter((filePath) => !assigned.has(filePath));
  const remainderShardCount = resolveRemainderShardCount();
  const remainderShards: ShardConfig[] = Array.from({ length: remainderShardCount }, (_, index) => {
    return {
      name: `remainder-${String(index + 1)}`,
      files: [],
      estimatedCost: 0,
    };
  });

  const sortedRemainder = [...remainderFiles].sort((left, right) => {
    return estimateFileCost(right) - estimateFileCost(left);
  });
  for (const filePath of sortedRemainder) {
    const target = remainderShards.reduce((best, candidate) => {
      return candidate.estimatedCost < best.estimatedCost ? candidate : best;
    });
    const fileCost = estimateFileCost(filePath);
    target.files.push(filePath);
    target.estimatedCost += fileCost;
  }

  for (const shard of remainderShards) {
    if (shard.files.length === 0) {
      continue;
    }
    shard.files.sort((left, right) => left.localeCompare(right));
    shards.push(shard);
  }

  return shards;
}

async function runShard(shard: ShardConfig): Promise<number> {
  const env = createShardEnv(shard.name);
  console.log(
    `[test:sharded] ${shard.name}: ${String(shard.files.length)} files (est=${String(shard.estimatedCost)})`,
  );
  return await new Promise<number>((resolveExitCode, rejectExitCode) => {
    const child = spawn('bun', ['test', '--reporter', 'dots', ...shard.files], {
      cwd: workspaceRoot,
      env,
      stdio: 'inherit',
    });
    child.once('error', rejectExitCode);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}

const allFiles = collectTestFiles(testRoot);
if (allFiles.length === 0) {
  throw new Error('no test files found under test/');
}

const shards = buildShards(allFiles);
console.log(
  `[test:sharded] running ${String(allFiles.length)} files across ${String(shards.length)} shards`,
);

const results = await Promise.all(
  shards.map(async (shard) => {
    const exitCode = await runShard(shard);
    return {
      name: shard.name,
      exitCode,
    };
  }),
);

const failed = results.filter((result) => result.exitCode !== 0);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`[test:sharded] shard failed: ${result.name} (exit=${String(result.exitCode)})`);
  }
  process.exit(1);
}
