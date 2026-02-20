import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ReleaseBumpLevel = 'major' | 'minor' | 'patch';

interface ReleaseOptions {
  version: string | null;
  bump: ReleaseBumpLevel | null;
  skipVerify: boolean;
  branch: string;
  remote: string;
  allowDirty: boolean;
}

interface ReleaseRuntime {
  cwd(): string;
  readTextFile(path: string): string;
  writeTextFile(path: string, text: string): void;
  capture(command: string, args: readonly string[]): string;
  run(command: string, args: readonly string[]): void;
  stdout(text: string): void;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SEMVER_PARSE_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^(0|[1-9]\d*)$/u;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface ReleaseCommandStep {
  label: string;
  command: string;
  args: readonly string[];
}

interface ReleaseCommandResult {
  label: string;
  durationMs: number;
}

const DEFAULT_OPTIONS: ReleaseOptions = {
  version: null,
  bump: null,
  skipVerify: false,
  branch: 'main',
  remote: 'origin',
  allowDirty: false,
};

function usage(): string {
  return [
    'Usage: bun run release [--version <semver> | --release <semver>] [--bump <major|minor|patch>] [--skip-verify] [--branch <name>] [--remote <name>] [--allow-dirty]',
    '',
    'Bumps package.json version, commits, and pushes a SemVer tag that triggers GitHub release automation.',
    'Default release bump is patch (prefixed tag format: "v<version>").',
  ].join('\n');
}

function normalizeSemverTag(versionInput: string): string {
  const trimmed = versionInput.trim();
  if (trimmed.length === 0) {
    throw new Error('version cannot be empty');
  }
  const normalized = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!SEMVER_PATTERN.test(normalized)) {
    throw new Error(`invalid semver version: ${versionInput}`);
  }
  return `v${normalized}`;
}

function bumpSemverVersion(versionInput: string, bump: ReleaseBumpLevel): string {
  const tag = normalizeSemverTag(versionInput);
  const normalized = tag.slice(1);
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      normalized,
    );
  if (match === null) {
    throw new Error(`invalid semver version: ${versionInput}`);
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (bump === 'major') {
    return `${String(major + 1)}.0.0`;
  }
  if (bump === 'minor') {
    return `${String(major)}.${String(minor + 1)}.0`;
  }
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

function parseArgs(argv: readonly string[]): ReleaseOptions | null {
  const options: ReleaseOptions = { ...DEFAULT_OPTIONS };
  const assignBump = (value: string): void => {
    if (value !== 'major' && value !== 'minor' && value !== 'patch') {
      throw new Error(`invalid bump level: ${value}`);
    }
    if (options.bump !== null && options.bump !== value) {
      throw new Error('only one bump level can be specified');
    }
    options.bump = value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return null;
    }
    if (arg === '--skip-verify') {
      options.skipVerify = true;
      continue;
    }
    if (arg === '--allow-dirty') {
      options.allowDirty = true;
      continue;
    }
    if (arg === '--bump') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --bump');
      }
      assignBump(value);
      index += 1;
      continue;
    }
    if (arg === '--major') {
      assignBump('major');
      continue;
    }
    if (arg === '--minor') {
      assignBump('minor');
      continue;
    }
    if (arg === '--patch') {
      assignBump('patch');
      continue;
    }
    if (arg === '--version' || arg === '--release') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`missing value for ${arg}`);
      }
      options.version = value;
      index += 1;
      continue;
    }
    if (arg === '--branch') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --branch');
      }
      options.branch = value;
      index += 1;
      continue;
    }
    if (arg === '--remote') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --remote');
      }
      options.remote = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (options.version !== null && options.bump !== null) {
    throw new Error('cannot combine --version with --bump');
  }
  return options;
}

function parseSemverVersion(versionInput: string): ParsedSemver {
  const normalized = normalizeSemverTag(versionInput).slice(1);
  const match = SEMVER_PARSE_PATTERN.exec(normalized);
  if (match === null) {
    throw new Error(`invalid semver version: ${versionInput}`);
  }
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    if (leftNumber < rightNumber) {
      return -1;
    }
    if (leftNumber > rightNumber) {
      return 1;
    }
    return 0;
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  return left < right ? -1 : 1;
}

function compareSemverVersions(leftVersionInput: string, rightVersionInput: string): number {
  const left = parseSemverVersion(leftVersionInput);
  const right = parseSemverVersion(rightVersionInput);
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }
  const maxIndex = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxIndex; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function ensureReleaseVersionIsIncreasing(currentVersion: string, targetVersion: string): void {
  const comparison = compareSemverVersions(targetVersion, currentVersion);
  if (comparison <= 0) {
    throw new Error(
      `release version must be greater than package.json version (${currentVersion}); received ${targetVersion}`,
    );
  }
}

function readPackageVersion(runtime: ReleaseRuntime): string {
  const packagePath = resolve(runtime.cwd(), 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(runtime.readTextFile(packagePath));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse package.json: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json root must be an object');
  }
  const version = (parsed as Record<string, unknown>).version;
  if (typeof version !== 'string') {
    throw new Error('package.json version must be a string');
  }
  return version;
}

function resolveReleaseTag(options: ReleaseOptions, runtime: ReleaseRuntime): string {
  if (options.version !== null) {
    return normalizeSemverTag(options.version);
  }
  const currentVersion = readPackageVersion(runtime);
  const bumpLevel = options.bump ?? 'patch';
  return normalizeSemverTag(bumpSemverVersion(currentVersion, bumpLevel));
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9._:@/=-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args.map((arg) => quoteArg(arg))].join(' ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${String(minutes)}m ${String(seconds)}s`;
}

function printReleaseBanner(options: ReleaseOptions, runtime: ReleaseRuntime): void {
  runtime.stdout('\n== Harness Release ==\n');
  runtime.stdout(`branch: ${options.branch}\n`);
  runtime.stdout(`remote: ${options.remote}\n`);
  runtime.stdout(`verify: ${options.skipVerify ? 'skip' : 'bun run verify'}\n`);
  runtime.stdout('\n');
}

function runCommandStep(
  step: ReleaseCommandStep,
  index: number,
  total: number,
  runtime: ReleaseRuntime,
): ReleaseCommandResult {
  runtime.stdout(`[${String(index)}/${String(total)}] ${step.label}\n`);
  runtime.stdout(`    $ ${commandText(step.command, step.args)}\n`);
  const startedAt = Date.now();
  try {
    runtime.run(step.command, step.args);
  } catch (error: unknown) {
    const elapsed = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${step.label} failed after ${formatDuration(elapsed)} (${commandText(step.command, step.args)}): ${message}`,
    );
  }
  const durationMs = Date.now() - startedAt;
  runtime.stdout(`    ok ${formatDuration(durationMs)}\n`);
  return {
    label: step.label,
    durationMs,
  };
}

function printReleaseSummary(
  tag: string,
  previousVersion: string,
  targetVersion: string,
  commandResults: readonly ReleaseCommandResult[],
  totalDurationMs: number,
  runtime: ReleaseRuntime,
): void {
  runtime.stdout('\nSummary:\n');
  const width = commandResults.reduce((max, result) => Math.max(max, result.label.length), 0);
  for (const result of commandResults) {
    const label = result.label.padEnd(width, ' ');
    runtime.stdout(`  - ${label}  ${formatDuration(result.durationMs)}\n`);
  }
  runtime.stdout(`  - version      ${previousVersion} -> ${targetVersion}\n`);
  runtime.stdout(`  - tag          ${tag}\n`);
  runtime.stdout(`  - total        ${formatDuration(totalDurationMs)}\n\n`);
  runtime.stdout(`pushed ${tag}; GitHub release workflow should start shortly.\n`);
}

function requireCleanWorkingTree(runtime: ReleaseRuntime): void {
  const status = runtime.capture('git', ['status', '--porcelain']).trim();
  if (status.length > 0) {
    throw new Error('working tree is not clean; commit or stash changes before releasing');
  }
}

function ensureTagDoesNotExist(tag: string, remote: string, runtime: ReleaseRuntime): void {
  const localTag = runtime.capture('git', ['tag', '--list', tag]).trim();
  if (localTag.length > 0) {
    throw new Error(`tag already exists locally: ${tag}`);
  }
  const remoteTag = runtime
    .capture('git', ['ls-remote', '--tags', remote, `refs/tags/${tag}`])
    .trim();
  if (remoteTag.length > 0) {
    throw new Error(`tag already exists on ${remote}: ${tag}`);
  }
}

function updatePackageVersion(tag: string, runtime: ReleaseRuntime): void {
  const packagePath = resolve(runtime.cwd(), 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(runtime.readTextFile(packagePath));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse package.json: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package.json root must be an object');
  }
  const record = parsed as Record<string, unknown>;
  record.version = tag.slice(1);
  runtime.writeTextFile(packagePath, `${JSON.stringify(record, null, 2)}\n`);
}

function executeRelease(options: ReleaseOptions, runtime: ReleaseRuntime): string {
  const startedAt = Date.now();
  printReleaseBanner(options, runtime);
  const commandResults: ReleaseCommandResult[] = [];

  if (!options.allowDirty) {
    requireCleanWorkingTree(runtime);
  }

  const commandSteps: ReleaseCommandStep[] = [];

  if (!options.skipVerify) {
    commandSteps.push({
      label: 'Verify quality gate',
      command: 'bun',
      args: ['run', 'verify'],
    });
  }
  commandSteps.push({
    label: `Checkout ${options.branch}`,
    command: 'git',
    args: ['checkout', options.branch],
  });
  commandSteps.push({
    label: `Pull ${options.remote}/${options.branch}`,
    command: 'git',
    args: ['pull', '--ff-only', options.remote, options.branch],
  });

  for (let index = 0; index < commandSteps.length; index += 1) {
    commandResults.push(
      runCommandStep(commandSteps[index]!, index + 1, commandSteps.length, runtime),
    );
  }

  const previousVersion = readPackageVersion(runtime);
  const tag =
    options.version !== null
      ? normalizeSemverTag(options.version)
      : normalizeSemverTag(bumpSemverVersion(previousVersion, options.bump ?? 'patch'));
  const targetVersion = tag.slice(1);
  ensureReleaseVersionIsIncreasing(previousVersion, targetVersion);
  ensureTagDoesNotExist(tag, options.remote, runtime);

  runtime.stdout(`\nrelease tag: ${tag}\n`);
  runtime.stdout(`bump package version: ${previousVersion} -> ${targetVersion}\n\n`);
  updatePackageVersion(tag, runtime);

  const commitArgs = !options.skipVerify
    ? ['commit', '--no-verify', '-m', `chore: release ${tag}`]
    : ['commit', '-m', `chore: release ${tag}`];
  const publishSteps: ReleaseCommandStep[] = [
    {
      label: 'Stage package.json',
      command: 'git',
      args: ['add', 'package.json'],
    },
    {
      label: 'Create release commit',
      command: 'git',
      args: commitArgs,
    },
    {
      label: `Push ${options.branch}`,
      command: 'git',
      args: ['push', options.remote, options.branch],
    },
    {
      label: `Create tag ${tag}`,
      command: 'git',
      args: ['tag', '-a', tag, '-m', tag],
    },
    {
      label: `Push tag ${tag}`,
      command: 'git',
      args: ['push', options.remote, tag],
    },
  ];
  for (let index = 0; index < publishSteps.length; index += 1) {
    commandResults.push(
      runCommandStep(publishSteps[index]!, index + 1, publishSteps.length, runtime),
    );
  }

  printReleaseSummary(
    tag,
    previousVersion,
    targetVersion,
    commandResults,
    Date.now() - startedAt,
    runtime,
  );
  return tag;
}

const defaultRuntime: ReleaseRuntime = {
  cwd: () => process.cwd(),
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => {
    writeFileSync(path, text, 'utf8');
  },
  capture: (command, args) => execFileSync(command, args, { encoding: 'utf8' }),
  run: (command, args) => {
    execFileSync(command, args, { stdio: 'inherit' });
  },
  stdout: (text) => {
    process.stdout.write(text);
  },
};

async function main(): Promise<void> {
  let options: ReleaseOptions | null;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (options === null) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
    return;
  }

  try {
    executeRelease(options, defaultRuntime);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}

export const __releaseInternals = {
  DEFAULT_OPTIONS,
  normalizeSemverTag,
  bumpSemverVersion,
  compareSemverVersions,
  ensureReleaseVersionIsIncreasing,
  parseArgs,
  resolveReleaseTag,
  requireCleanWorkingTree,
  ensureTagDoesNotExist,
  updatePackageVersion,
  executeRelease,
  usage,
};
