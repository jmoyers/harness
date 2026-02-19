import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { __releaseInternals } from '../scripts/release.ts';

interface MockRuntime {
  readonly cwdValue: string;
  fileText: string;
  readonly captures: Map<string, string>;
  readonly captureCalls: string[];
  readonly runCalls: string[];
  readonly writeCalls: string[];
  readonly stdoutLines: string[];
}

function createRuntime(
  overrides: Partial<Pick<MockRuntime, 'cwdValue' | 'fileText' | 'captures'>> = {},
) {
  const runtimeState: MockRuntime = {
    cwdValue: overrides.cwdValue ?? '/tmp/harness',
    fileText: overrides.fileText ?? JSON.stringify({ version: '0.1.0' }),
    captures: overrides.captures ?? new Map<string, string>(),
    captureCalls: [],
    runCalls: [],
    writeCalls: [],
    stdoutLines: [],
  };
  const runtime = {
    cwd: () => runtimeState.cwdValue,
    readTextFile: (_path: string) => runtimeState.fileText,
    writeTextFile: (path: string, text: string) => {
      runtimeState.writeCalls.push([path, text].join('\u0000'));
      runtimeState.fileText = text;
    },
    capture: (command: string, args: readonly string[]) => {
      const key = [command, ...args].join('\u0000');
      runtimeState.captureCalls.push(key);
      return runtimeState.captures.get(key) ?? '';
    },
    run: (command: string, args: readonly string[]) => {
      runtimeState.runCalls.push([command, ...args].join('\u0000'));
    },
    stdout: (text: string) => {
      runtimeState.stdoutLines.push(text);
    },
  };
  return { runtime, runtimeState };
}

void test('release script arg parsing handles defaults and flags', () => {
  assert.deepEqual(__releaseInternals.parseArgs([]), {
    version: null,
    bump: null,
    skipVerify: false,
    branch: 'main',
    remote: 'origin',
    allowDirty: false,
  });
  assert.deepEqual(__releaseInternals.parseArgs(['--bump', 'patch']), {
    version: null,
    bump: 'patch',
    skipVerify: false,
    branch: 'main',
    remote: 'origin',
    allowDirty: false,
  });
  assert.deepEqual(
    __releaseInternals.parseArgs([
      '--bump',
      'minor',
      '--skip-verify',
      '--branch',
      'release',
      '--remote',
      'upstream',
      '--allow-dirty',
    ]),
    {
      version: null,
      bump: 'minor',
      skipVerify: true,
      branch: 'release',
      remote: 'upstream',
      allowDirty: true,
    },
  );
  assert.deepEqual(__releaseInternals.parseArgs(['--major']), {
    version: null,
    bump: 'major',
    skipVerify: false,
    branch: 'main',
    remote: 'origin',
    allowDirty: false,
  });
  assert.deepEqual(__releaseInternals.parseArgs(['--minor']), {
    version: null,
    bump: 'minor',
    skipVerify: false,
    branch: 'main',
    remote: 'origin',
    allowDirty: false,
  });
  assert.deepEqual(__releaseInternals.parseArgs(['--patch']), {
    version: null,
    bump: 'patch',
    skipVerify: false,
    branch: 'main',
    remote: 'origin',
    allowDirty: false,
  });
  assert.deepEqual(
    __releaseInternals.parseArgs([
      '--release',
      '1.2.4',
      '--skip-verify',
      '--branch',
      'release',
      '--remote',
      'upstream',
      '--allow-dirty',
    ]),
    {
      version: '1.2.4',
      bump: null,
      skipVerify: true,
      branch: 'release',
      remote: 'upstream',
      allowDirty: true,
    },
  );
  assert.deepEqual(
    __releaseInternals.parseArgs([
      '--version',
      '1.2.3',
      '--skip-verify',
      '--branch',
      'release',
      '--remote',
      'upstream',
      '--allow-dirty',
    ]),
    {
      version: '1.2.3',
      bump: null,
      skipVerify: true,
      branch: 'release',
      remote: 'upstream',
      allowDirty: true,
    },
  );
  assert.equal(__releaseInternals.parseArgs(['--help']), null);
  assert.throws(() => __releaseInternals.parseArgs(['--version']), /missing value for --version/u);
  assert.throws(() => __releaseInternals.parseArgs(['--release']), /missing value for --release/u);
  assert.throws(() => __releaseInternals.parseArgs(['--bump']), /missing value for --bump/u);
  assert.throws(() => __releaseInternals.parseArgs(['--bump', 'oops']), /invalid bump level/u);
  assert.throws(
    () => __releaseInternals.parseArgs(['--major', '--minor']),
    /only one bump level can be specified/u,
  );
  assert.throws(
    () => __releaseInternals.parseArgs(['--version', '1.2.3', '--bump', 'patch']),
    /cannot combine --version with --bump/u,
  );
  assert.throws(
    () => __releaseInternals.parseArgs(['--release', '1.2.4', '--bump', 'patch']),
    /cannot combine --version with --bump/u,
  );
  assert.throws(() => __releaseInternals.parseArgs(['--wat']), /unknown argument/u);
});

void test('release script normalizes semver tags and rejects invalid versions', () => {
  assert.equal(__releaseInternals.normalizeSemverTag('1.2.3'), 'v1.2.3');
  assert.equal(__releaseInternals.normalizeSemverTag('v1.2.3'), 'v1.2.3');
  assert.equal(__releaseInternals.normalizeSemverTag('1.2.3-beta.1'), 'v1.2.3-beta.1');
  assert.throws(() => __releaseInternals.normalizeSemverTag(''), /cannot be empty/u);
  assert.throws(
    () => __releaseInternals.normalizeSemverTag('feature-branch'),
    /invalid semver version/u,
  );
});

void test('release script compares semver versions with prerelease precedence', () => {
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3', '1.2.3'), 0);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.4', '1.2.3'), 1);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3', '1.2.4'), -1);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3', '1.2.3-beta.1'), 1);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3-beta.1', '1.2.3'), -1);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3-beta.2', '1.2.3-beta.10'), -1);
  assert.equal(__releaseInternals.compareSemverVersions('1.2.3-beta.10', '1.2.3-beta.2'), 1);
});

void test('release script bumps semver versions by level', () => {
  assert.equal(__releaseInternals.bumpSemverVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(__releaseInternals.bumpSemverVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(__releaseInternals.bumpSemverVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(__releaseInternals.bumpSemverVersion('v1.2.3', 'patch'), '1.2.4');
  assert.equal(__releaseInternals.bumpSemverVersion('1.2.3-beta.1', 'patch'), '1.2.4');
  assert.throws(
    () => __releaseInternals.bumpSemverVersion('feature-branch', 'patch'),
    /invalid semver version/u,
  );
});

void test('release script resolves tag from package version or explicit override', () => {
  const { runtime } = createRuntime({
    fileText: JSON.stringify({ version: '2.3.4' }),
  });
  assert.equal(
    __releaseInternals.resolveReleaseTag(
      {
        version: null,
        bump: null,
        skipVerify: false,
        branch: 'main',
        remote: 'origin',
        allowDirty: false,
      },
      runtime,
    ),
    'v2.3.5',
  );
  assert.equal(
    __releaseInternals.resolveReleaseTag(
      {
        version: 'v3.4.5',
        bump: null,
        skipVerify: false,
        branch: 'main',
        remote: 'origin',
        allowDirty: false,
      },
      runtime,
    ),
    'v3.4.5',
  );
  assert.equal(
    __releaseInternals.resolveReleaseTag(
      {
        version: null,
        bump: 'minor',
        skipVerify: false,
        branch: 'main',
        remote: 'origin',
        allowDirty: false,
      },
      runtime,
    ),
    'v2.4.0',
  );
});

void test('release script default flow computes a patch bump tag', () => {
  const { runtime } = createRuntime({
    fileText: JSON.stringify({ version: '1.9.9' }),
  });
  assert.equal(
    __releaseInternals.resolveReleaseTag(
      {
        version: null,
        bump: null,
        skipVerify: false,
        branch: 'main',
        remote: 'origin',
        allowDirty: false,
      },
      runtime,
    ),
    'v1.9.10',
  );
});

void test('release script requires a clean working tree by default', () => {
  const key = ['git', 'status', '--porcelain'].join('\u0000');
  const { runtime } = createRuntime({
    captures: new Map<string, string>([[key, ' M README.md\n']]),
  });
  assert.throws(
    () => __releaseInternals.requireCleanWorkingTree(runtime),
    /working tree is not clean/u,
  );
});

void test('release script guards against duplicate local and remote tags', () => {
  const localKey = ['git', 'tag', '--list', 'v0.1.0'].join('\u0000');
  const remoteKey = ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/v0.1.0'].join('\u0000');

  const localRuntime = createRuntime({
    captures: new Map<string, string>([[localKey, 'v0.1.0\n']]),
  }).runtime;
  assert.throws(
    () => __releaseInternals.ensureTagDoesNotExist('v0.1.0', 'origin', localRuntime),
    /already exists locally/u,
  );

  const remoteRuntime = createRuntime({
    captures: new Map<string, string>([
      [localKey, ''],
      [remoteKey, 'abc123\trefs/tags/v0.1.0\n'],
    ]),
  }).runtime;
  assert.throws(
    () => __releaseInternals.ensureTagDoesNotExist('v0.1.0', 'origin', remoteRuntime),
    /already exists on origin/u,
  );
});

void test('release script default flow executes verify, bump commit, and tag sequence', () => {
  const statusKey = ['git', 'status', '--porcelain'].join('\u0000');
  const localTagKey = ['git', 'tag', '--list', 'v0.1.1'].join('\u0000');
  const remoteTagKey = ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/v0.1.1'].join('\u0000');
  const { runtime, runtimeState } = createRuntime({
    captures: new Map<string, string>([
      [statusKey, ''],
      [localTagKey, ''],
      [remoteTagKey, ''],
    ]),
  });

  const tag = __releaseInternals.executeRelease(
    {
      version: null,
      bump: null,
      skipVerify: false,
      branch: 'main',
      remote: 'origin',
      allowDirty: false,
    },
    runtime,
  );

  assert.equal(tag, 'v0.1.1');
  assert.equal(runtimeState.writeCalls.length, 1);
  const updated = JSON.parse(runtimeState.fileText) as Record<string, unknown>;
  assert.equal(updated.version, '0.1.1');
  assert.deepEqual(runtimeState.runCalls, [
    ['bun', 'run', 'verify'].join('\u0000'),
    ['git', 'checkout', 'main'].join('\u0000'),
    ['git', 'pull', '--ff-only', 'origin', 'main'].join('\u0000'),
    ['git', 'add', 'package.json'].join('\u0000'),
    ['git', 'commit', '-m', 'chore: release v0.1.1'].join('\u0000'),
    ['git', 'push', 'origin', 'main'].join('\u0000'),
    ['git', 'tag', '-a', 'v0.1.1', '-m', 'v0.1.1'].join('\u0000'),
    ['git', 'push', 'origin', 'v0.1.1'].join('\u0000'),
  ]);
});

void test('release script skip-verify omits quality gate execution', () => {
  const statusKey = ['git', 'status', '--porcelain'].join('\u0000');
  const localTagKey = ['git', 'tag', '--list', 'v0.2.1'].join('\u0000');
  const remoteTagKey = ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/v0.2.1'].join('\u0000');
  const { runtime, runtimeState } = createRuntime({
    fileText: JSON.stringify({ version: '0.2.0' }),
    captures: new Map<string, string>([
      [statusKey, ''],
      [localTagKey, ''],
      [remoteTagKey, ''],
    ]),
  });

  __releaseInternals.executeRelease(
    {
      version: null,
      bump: null,
      skipVerify: true,
      branch: 'main',
      remote: 'origin',
      allowDirty: false,
    },
    runtime,
  );

  assert.deepEqual(runtimeState.runCalls, [
    ['git', 'checkout', 'main'].join('\u0000'),
    ['git', 'pull', '--ff-only', 'origin', 'main'].join('\u0000'),
    ['git', 'add', 'package.json'].join('\u0000'),
    ['git', 'commit', '-m', 'chore: release v0.2.1'].join('\u0000'),
    ['git', 'push', 'origin', 'main'].join('\u0000'),
    ['git', 'tag', '-a', 'v0.2.1', '-m', 'v0.2.1'].join('\u0000'),
    ['git', 'push', 'origin', 'v0.2.1'].join('\u0000'),
  ]);
});

void test('release script bump flow updates package version and pushes branch before tag', () => {
  const statusKey = ['git', 'status', '--porcelain'].join('\u0000');
  const localTagKey = ['git', 'tag', '--list', 'v0.2.0'].join('\u0000');
  const remoteTagKey = ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/v0.2.0'].join('\u0000');
  const { runtime, runtimeState } = createRuntime({
    fileText: JSON.stringify({ version: '0.1.0' }),
    captures: new Map<string, string>([
      [statusKey, ''],
      [localTagKey, ''],
      [remoteTagKey, ''],
    ]),
  });

  const tag = __releaseInternals.executeRelease(
    {
      version: null,
      bump: 'minor',
      skipVerify: true,
      branch: 'main',
      remote: 'origin',
      allowDirty: false,
    },
    runtime,
  );

  assert.equal(tag, 'v0.2.0');
  assert.equal(runtimeState.writeCalls.length, 1);
  const updated = JSON.parse(runtimeState.fileText) as Record<string, unknown>;
  assert.equal(updated.version, '0.2.0');
  assert.deepEqual(runtimeState.runCalls, [
    ['git', 'checkout', 'main'].join('\u0000'),
    ['git', 'pull', '--ff-only', 'origin', 'main'].join('\u0000'),
    ['git', 'add', 'package.json'].join('\u0000'),
    ['git', 'commit', '-m', 'chore: release v0.2.0'].join('\u0000'),
    ['git', 'push', 'origin', 'main'].join('\u0000'),
    ['git', 'tag', '-a', 'v0.2.0', '-m', 'v0.2.0'].join('\u0000'),
    ['git', 'push', 'origin', 'v0.2.0'].join('\u0000'),
  ]);
});

void test('release script explicit version flow updates package version and pushes branch before tag', () => {
  const statusKey = ['git', 'status', '--porcelain'].join('\u0000');
  const localTagKey = ['git', 'tag', '--list', 'v0.1.5'].join('\u0000');
  const remoteTagKey = ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/v0.1.5'].join('\u0000');
  const { runtime, runtimeState } = createRuntime({
    fileText: JSON.stringify({ version: '0.1.4' }),
    captures: new Map<string, string>([
      [statusKey, ''],
      [localTagKey, ''],
      [remoteTagKey, ''],
    ]),
  });

  const tag = __releaseInternals.executeRelease(
    {
      version: '0.1.5',
      bump: null,
      skipVerify: true,
      branch: 'main',
      remote: 'origin',
      allowDirty: false,
    },
    runtime,
  );

  assert.equal(tag, 'v0.1.5');
  assert.equal(runtimeState.writeCalls.length, 1);
  const updated = JSON.parse(runtimeState.fileText) as Record<string, unknown>;
  assert.equal(updated.version, '0.1.5');
  assert.deepEqual(runtimeState.runCalls, [
    ['git', 'checkout', 'main'].join('\u0000'),
    ['git', 'pull', '--ff-only', 'origin', 'main'].join('\u0000'),
    ['git', 'add', 'package.json'].join('\u0000'),
    ['git', 'commit', '-m', 'chore: release v0.1.5'].join('\u0000'),
    ['git', 'push', 'origin', 'main'].join('\u0000'),
    ['git', 'tag', '-a', 'v0.1.5', '-m', 'v0.1.5'].join('\u0000'),
    ['git', 'push', 'origin', 'v0.1.5'].join('\u0000'),
  ]);
});

void test('release script rejects explicit non-increasing versions', () => {
  const statusKey = ['git', 'status', '--porcelain'].join('\u0000');
  const { runtime } = createRuntime({
    fileText: JSON.stringify({ version: '0.1.5' }),
    captures: new Map<string, string>([[statusKey, '']]),
  });

  assert.throws(
    () =>
      __releaseInternals.executeRelease(
        {
          version: '0.1.5',
          bump: null,
          skipVerify: true,
          branch: 'main',
          remote: 'origin',
          allowDirty: false,
        },
        runtime,
      ),
    /release version must be greater than package\.json version/u,
  );
});
