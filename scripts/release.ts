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
    'Usage: bun run release [--version <semver>] [--bump <major|minor|patch>] [--skip-verify] [--branch <name>] [--remote <name>] [--allow-dirty]',
    '',
    'Creates and pushes a SemVer tag that triggers GitHub release automation.',
    'Default tag source is package.json version (prefixed with "v").',
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
    if (arg === '--version') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --version');
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
  if (options.bump !== null) {
    return normalizeSemverTag(bumpSemverVersion(readPackageVersion(runtime), options.bump));
  }
  if (options.version !== null) {
    return normalizeSemverTag(options.version);
  }
  return normalizeSemverTag(readPackageVersion(runtime));
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
  if (!options.allowDirty) {
    requireCleanWorkingTree(runtime);
  }

  const runStep = (command: string, args: readonly string[]): void => {
    runtime.stdout(`> ${commandText(command, args)}\n`);
    runtime.run(command, args);
  };

  if (!options.skipVerify) {
    runStep('bun', ['run', 'verify']);
  }
  runStep('git', ['checkout', options.branch]);
  runStep('git', ['pull', '--ff-only', options.remote, options.branch]);
  const tag = resolveReleaseTag(options, runtime);
  runtime.stdout(`release tag: ${tag}\n`);
  ensureTagDoesNotExist(tag, options.remote, runtime);
  if (options.bump !== null) {
    const previousVersion = readPackageVersion(runtime);
    runtime.stdout(`bump package version: ${previousVersion} -> ${tag.slice(1)}\n`);
    updatePackageVersion(tag, runtime);
    runStep('git', ['add', 'package.json']);
    runStep('git', ['commit', '-m', `chore: release ${tag}`]);
    runStep('git', ['push', options.remote, options.branch]);
  }
  runStep('git', ['tag', '-a', tag, '-m', tag]);
  runStep('git', ['push', options.remote, tag]);
  runtime.stdout(`pushed ${tag}; GitHub release workflow should start shortly.\n`);
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
  parseArgs,
  resolveReleaseTag,
  requireCleanWorkingTree,
  ensureTagDoesNotExist,
  updatePackageVersion,
  executeRelease,
  usage,
};
