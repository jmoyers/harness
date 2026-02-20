import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

interface ShardConfig {
  name: string;
  files: string[];
  estimatedCost: number;
}

interface CoverageOptions {
  enabled: boolean;
  baseDir: string;
  writeLcov: boolean;
}

interface RunnerOptions {
  bunTestArgs: string[];
  coverage: CoverageOptions;
}

interface FunctionCoverage {
  line: number;
  hit: boolean;
}

interface BranchCoverage {
  line: number;
  block: string;
  branch: string;
  hit: boolean;
}

interface FileCoverageAggregate {
  sourceFile: string;
  lines: Map<number, boolean>;
  functions: Map<string, FunctionCoverage>;
  branches: Map<string, BranchCoverage>;
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

function parseCoverageReporterList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function parseRunnerOptions(args: readonly string[]): RunnerOptions {
  const bunTestArgs: string[] = [];
  let coverageEnabled = false;
  let coverageDir = 'coverage';
  const reporters: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--coverage') {
      coverageEnabled = true;
      bunTestArgs.push(arg);
      continue;
    }
    if (arg === '--coverage-dir') {
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('missing value for --coverage-dir');
      }
      coverageEnabled = true;
      coverageDir = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--coverage-dir=')) {
      const value = arg.slice('--coverage-dir='.length);
      if (value.length === 0) {
        throw new Error('missing value for --coverage-dir');
      }
      coverageEnabled = true;
      coverageDir = value;
      continue;
    }
    if (arg === '--coverage-reporter') {
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('missing value for --coverage-reporter');
      }
      reporters.push(...parseCoverageReporterList(next));
      bunTestArgs.push(arg, next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--coverage-reporter=')) {
      const value = arg.slice('--coverage-reporter='.length);
      if (value.length === 0) {
        throw new Error('missing value for --coverage-reporter');
      }
      reporters.push(...parseCoverageReporterList(value));
      bunTestArgs.push(arg);
      continue;
    }
    bunTestArgs.push(arg);
  }
  if (coverageEnabled && !bunTestArgs.includes('--coverage')) {
    bunTestArgs.unshift('--coverage');
  }
  const writeLcov = coverageEnabled && reporters.includes('lcov');
  return {
    bunTestArgs,
    coverage: {
      enabled: coverageEnabled,
      baseDir: coverageDir,
      writeLcov,
    },
  };
}

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

function parsePositiveInteger(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function readLcovIntoAggregate(
  filePath: string,
  records: Map<string, FileCoverageAggregate>,
): void {
  const text = readFileSync(filePath, 'utf8');
  let current: FileCoverageAggregate | null = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith('SF:')) {
      const sourceFile = line.slice(3);
      const existing = records.get(sourceFile);
      if (existing !== undefined) {
        current = existing;
      } else {
        const created: FileCoverageAggregate = {
          sourceFile,
          lines: new Map<number, boolean>(),
          functions: new Map<string, FunctionCoverage>(),
          branches: new Map<string, BranchCoverage>(),
        };
        records.set(sourceFile, created);
        current = created;
      }
      continue;
    }
    if (line === 'end_of_record') {
      current = null;
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('DA:')) {
      const [lineText, hitsText] = line.slice(3).split(',');
      const lineNumber = parsePositiveInteger(lineText ?? '');
      const hits = parsePositiveInteger(hitsText ?? '');
      if (lineNumber === null || hits === null) {
        continue;
      }
      const alreadyHit = current.lines.get(lineNumber) === true;
      current.lines.set(lineNumber, alreadyHit || hits > 0);
      continue;
    }
    if (line.startsWith('FN:')) {
      const payload = line.slice(3);
      const separator = payload.indexOf(',');
      if (separator <= 0) {
        continue;
      }
      const lineNumber = parsePositiveInteger(payload.slice(0, separator));
      const name = payload.slice(separator + 1);
      if (lineNumber === null || name.length === 0) {
        continue;
      }
      const existing = current.functions.get(name);
      if (existing === undefined) {
        current.functions.set(name, { line: lineNumber, hit: false });
      }
      continue;
    }
    if (line.startsWith('FNDA:')) {
      const payload = line.slice(5);
      const separator = payload.indexOf(',');
      if (separator <= 0) {
        continue;
      }
      const hits = parsePositiveInteger(payload.slice(0, separator));
      const name = payload.slice(separator + 1);
      if (hits === null || name.length === 0) {
        continue;
      }
      const existing = current.functions.get(name);
      if (existing === undefined) {
        current.functions.set(name, { line: 0, hit: hits > 0 });
      } else if (hits > 0) {
        existing.hit = true;
      }
      continue;
    }
    if (line.startsWith('BRDA:')) {
      const [lineText, block, branch, taken] = line.slice(5).split(',');
      const lineNumber = parsePositiveInteger(lineText ?? '');
      if (lineNumber === null) {
        continue;
      }
      const branchKey = `${lineNumber}:${block ?? '0'}:${branch ?? '0'}`;
      const hit = taken !== undefined && taken !== '-' && (parsePositiveInteger(taken) ?? 0) > 0;
      const existing = current.branches.get(branchKey);
      if (existing === undefined) {
        current.branches.set(branchKey, {
          line: lineNumber,
          block: block ?? '0',
          branch: branch ?? '0',
          hit,
        });
      } else if (hit) {
        existing.hit = true;
      }
    }
  }
}

function writeMergedLcov(records: Map<string, FileCoverageAggregate>, outputPath: string): void {
  const output: string[] = [];
  const sortedFiles = [...records.values()].sort((left, right) =>
    left.sourceFile.localeCompare(right.sourceFile),
  );
  for (const fileRecord of sortedFiles) {
    output.push('TN:');
    output.push(`SF:${fileRecord.sourceFile}`);

    const functions = [...fileRecord.functions.entries()]
      .map(([name, coverage]) => {
        return { name, ...coverage };
      })
      .sort((left, right) => {
        if (left.line !== right.line) {
          return left.line - right.line;
        }
        return left.name.localeCompare(right.name);
      });
    for (const fn of functions) {
      output.push(`FN:${String(fn.line)},${fn.name}`);
    }
    for (const fn of functions) {
      output.push(`FNDA:${fn.hit ? '1' : '0'},${fn.name}`);
    }
    output.push(`FNF:${String(functions.length)}`);
    output.push(`FNH:${String(functions.filter((fn) => fn.hit).length)}`);

    const lines = [...fileRecord.lines.entries()].sort(([left], [right]) => left - right);
    for (const [lineNumber, hit] of lines) {
      output.push(`DA:${String(lineNumber)},${hit ? '1' : '0'}`);
    }
    output.push(`LF:${String(lines.length)}`);
    output.push(`LH:${String(lines.filter(([, hit]) => hit).length)}`);

    const branches = [...fileRecord.branches.values()].sort((left, right) => {
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      if (left.block !== right.block) {
        return left.block.localeCompare(right.block);
      }
      return left.branch.localeCompare(right.branch);
    });
    for (const branch of branches) {
      output.push(
        `BRDA:${String(branch.line)},${branch.block},${branch.branch},${branch.hit ? '1' : '0'}`,
      );
    }
    output.push(`BRF:${String(branches.length)}`);
    output.push(`BRH:${String(branches.filter((branch) => branch.hit).length)}`);
    output.push('end_of_record');
  }
  writeFileSync(outputPath, `${output.join('\n')}\n`, 'utf8');
}

function mergeShardCoverageLcov(shards: readonly ShardConfig[], baseCoverageDir: string): void {
  const records = new Map<string, FileCoverageAggregate>();
  for (const shard of shards) {
    const shardLcovPath = join(baseCoverageDir, sanitizeLabel(shard.name), 'lcov.info');
    if (!existsSync(shardLcovPath)) {
      throw new Error(`missing lcov report for shard ${shard.name}: ${shardLcovPath}`);
    }
    readLcovIntoAggregate(shardLcovPath, records);
  }
  const mergedPath = join(baseCoverageDir, 'lcov.info');
  writeMergedLcov(records, mergedPath);
}

async function runShardWithOptions(
  shard: ShardConfig,
  runnerOptions: RunnerOptions,
  shardCoverageDir: string | null,
): Promise<number> {
  const env = createShardEnv(shard.name);
  console.log(
    `[test:sharded] ${shard.name}: ${String(shard.files.length)} files (est=${String(shard.estimatedCost)})`,
  );
  return await new Promise<number>((resolveExitCode, rejectExitCode) => {
    const bunArgs = ['test', '--reporter', 'dots', ...runnerOptions.bunTestArgs];
    if (shardCoverageDir !== null) {
      bunArgs.push('--coverage-dir', shardCoverageDir);
    }
    bunArgs.push(...shard.files);
    const child = spawn('bun', bunArgs, {
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

async function runShards(runnerOptions: RunnerOptions, baseCoverageDir: string): Promise<number> {
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
      const shardCoverageDir = runnerOptions.coverage.enabled
        ? join(baseCoverageDir, sanitizeLabel(shard.name))
        : null;
      const exitCode = await runShardWithOptions(shard, runnerOptions, shardCoverageDir);
      return {
        name: shard.name,
        exitCode,
      };
    }),
  );

  const failed = results.filter((result) => result.exitCode !== 0);
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(
        `[test:sharded] shard failed: ${result.name} (exit=${String(result.exitCode)})`,
      );
    }
    return 1;
  }

  if (runnerOptions.coverage.writeLcov) {
    mergeShardCoverageLcov(shards, baseCoverageDir);
  }

  return 0;
}

const runnerOptions = parseRunnerOptions(process.argv.slice(2));
const baseCoverageDir = resolve(workspaceRoot, runnerOptions.coverage.baseDir);
if (runnerOptions.coverage.enabled) {
  rmSync(baseCoverageDir, { recursive: true, force: true });
}

const exitCode = await runShards(runnerOptions, baseCoverageDir);
if (exitCode !== 0) {
  process.exit(exitCode);
}
