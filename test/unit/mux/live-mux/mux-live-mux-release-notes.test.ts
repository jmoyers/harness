import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  compareSemverTags,
  fetchReleaseNotesPrompt,
  parseReleaseNotesState,
  readInstalledHarnessVersion,
  readReleaseNotesState,
  resolveReleaseNotesPrompt,
  resolveReleaseNotesStatePath,
  writeReleaseNotesState,
} from '../../../../src/mux/live-mux/release-notes.ts';

void test('release notes semver comparison orders stable and prerelease tags correctly', () => {
  assert.equal(compareSemverTags('v1.2.3', '1.2.3'), 0);
  assert.equal(compareSemverTags('v1.2.4', '1.2.3') > 0, true);
  assert.equal(compareSemverTags('1.3.0', '1.2.9') > 0, true);
  assert.equal(compareSemverTags('2.0.0', '10.0.0') < 0, true);
  assert.equal(compareSemverTags('1.2.3', '1.2.3-rc.1') > 0, true);
  assert.equal(compareSemverTags('1.2.3-rc.2', '1.2.3-rc.1') > 0, true);
});

void test('release notes semver comparison covers prerelease edge branches and invalid tags', () => {
  assert.equal(compareSemverTags('1.0.0-alpha.1', '1.0.0-alpha.1'), 0);
  assert.equal(compareSemverTags('1.0.0-alpha', '1.0.0-alpha.1') < 0, true);
  assert.equal(compareSemverTags('1.0.0-alpha.1', '1.0.0-alpha') > 0, true);
  assert.equal(compareSemverTags('1.0.0-alpha', '1.0.0') < 0, true);
  assert.equal(compareSemverTags('1.0.0-1.alpha', '1.0.0-alpha.1') < 0, true);
  assert.equal(compareSemverTags('1.0.0-alpha.1', '1.0.0-1.alpha') > 0, true);
  assert.equal(compareSemverTags('1.0.0-beta', '1.0.0-alpha') > 0, true);

  const giantMajor = `v${'9'.repeat(400)}.1.1`;
  assert.equal(compareSemverTags('not-semver', '1.0.0'), 'not-semver'.localeCompare('1.0.0'));
  assert.equal(compareSemverTags(giantMajor, '1.0.0'), giantMajor.localeCompare('1.0.0'));
});

void test('release notes prompt resolution keeps only newer releases and first N body lines', () => {
  const prompt = resolveReleaseNotesPrompt({
    currentVersion: '1.2.0',
    releases: [
      {
        tag: 'v1.2.2',
        name: 'Patch 2',
        url: 'https://example.com/v1.2.2',
        body: 'line a\nline b\nline c\nline d',
      },
      {
        tag: 'v1.2.1',
        name: 'Patch 1',
        url: 'https://example.com/v1.2.1',
        body: '\nfoo\n\nbar\n',
      },
      {
        tag: 'v1.2.0',
        name: 'Current',
        url: 'https://example.com/v1.2.0',
        body: 'ignored',
      },
    ],
    previewLineCount: 2,
    maxReleases: 5,
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.latestTag, 'v1.2.2');
  assert.deepEqual(
    prompt?.releases.map((release) => release.tag),
    ['v1.2.2', 'v1.2.1'],
  );
  assert.deepEqual(prompt?.releases[0]?.previewLines, ['line a', 'line b']);
  assert.equal(prompt?.releases[0]?.previewTruncated, true);
  assert.deepEqual(prompt?.releases[1]?.previewLines, ['foo', 'bar']);
  assert.equal(prompt?.releases[1]?.previewTruncated, false);
});

void test('release notes prompt resolution returns null when releases list is empty', () => {
  assert.equal(
    resolveReleaseNotesPrompt({
      currentVersion: '1.2.0',
      releases: [],
      previewLineCount: 3,
      maxReleases: 3,
    }),
    null,
  );
});

void test('release notes prompt resolution returns null when nothing is newer', () => {
  const prompt = resolveReleaseNotesPrompt({
    currentVersion: '1.2.0',
    releases: [
      {
        tag: 'v1.2.0',
        name: 'Current',
        url: 'https://example.com/v1.2.0',
        body: 'same version',
      },
    ],
    previewLineCount: 3,
    maxReleases: 3,
  });
  assert.equal(prompt, null);
});

void test('release notes prompt resolution clamps invalid preview and release limits', () => {
  const prompt = resolveReleaseNotesPrompt({
    currentVersion: '1.0.0',
    releases: [
      {
        tag: 'v1.0.2',
        name: '',
        url: 'https://example.com/v1.0.2',
        body: 'line-a\nline-b',
      },
      {
        tag: 'v1.0.1',
        name: '',
        url: 'https://example.com/v1.0.1',
        body: 'line-c',
      },
    ],
    previewLineCount: 0,
    maxReleases: 0,
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.releases.length, 1);
  assert.deepEqual(prompt?.releases[0]?.previewLines, ['line-a']);
  assert.equal(prompt?.releases[0]?.previewTruncated, true);
});

void test('release notes fetch maps github payload and ignores drafts prereleases and malformed rows', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify([
        {
          tag_name: 'v1.1.0',
          name: 'v1.1.0',
          html_url: 'https://example.com/v1.1.0',
          body: 'first\\nsecond\\nthird',
          draft: false,
          prerelease: false,
        },
        {
          tag_name: 'v1.0.9',
          name: 'v1.0.9',
          html_url: 'https://example.com/v1.0.9',
          body: 'older',
          draft: false,
          prerelease: false,
        },
        {
          tag_name: 'v1.2.0-rc.1',
          name: 'rc',
          html_url: 'https://example.com/rc',
          body: 'ignore prerelease',
          draft: false,
          prerelease: true,
        },
        {
          tag_name: 'v1.0.8',
          name: 'draft',
          html_url: 'https://example.com/draft',
          body: 'ignore draft',
          draft: true,
          prerelease: false,
        },
        {
          tag_name: 1,
          html_url: 'https://example.com/bad',
          body: 'bad',
          draft: false,
          prerelease: false,
        },
      ]),
      { status: 200 },
    );
  };
  const prompt = await fetchReleaseNotesPrompt({
    currentVersion: '1.0.8',
    previewLineCount: 2,
    maxReleases: 2,
    fetchImpl: mockFetch,
    apiUrl: 'https://example.invalid/releases',
    releasesPageUrl: 'https://example.invalid/notes',
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.latestTag, 'v1.1.0');
  assert.equal(prompt?.releasesPageUrl, 'https://example.invalid/notes');
  assert.deepEqual(
    prompt?.releases.map((release) => release.tag),
    ['v1.1.0', 'v1.0.9'],
  );
});

void test('release notes fetch fails soft on non-ok or thrown fetch responses', async () => {
  const nonOkFetch: typeof fetch = async () => new Response('oops', { status: 503 });
  const thrownFetch: typeof fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(
    await fetchReleaseNotesPrompt({
      currentVersion: '1.0.0',
      previewLineCount: 2,
      maxReleases: 2,
      fetchImpl: nonOkFetch,
    }),
    null,
  );
  assert.equal(
    await fetchReleaseNotesPrompt({
      currentVersion: '1.0.0',
      previewLineCount: 2,
      maxReleases: 2,
      fetchImpl: thrownFetch,
    }),
    null,
  );
});

void test('release notes fetch handles non-array payloads and no-newer-release payloads', async () => {
  let lastUrl = '';
  let lastUserAgent = '';
  const nonArrayFetch: typeof fetch = async (input, init) => {
    lastUrl = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    lastUserAgent = headers?.['User-Agent'] ?? '';
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const noNewerFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify([
        {
          tag_name: 'v1.0.0',
          html_url: 'https://example.com/v1.0.0',
          body: 'same',
          draft: false,
          prerelease: false,
        },
      ]),
      { status: 200 },
    );
  };

  assert.equal(
    await fetchReleaseNotesPrompt({
      currentVersion: '1.0.0',
      previewLineCount: 2,
      maxReleases: 2,
      fetchImpl: nonArrayFetch,
      apiUrl: 'https://example.invalid/releases',
    }),
    null,
  );
  assert.equal(lastUrl.endsWith('?per_page=20'), true);
  assert.equal(lastUserAgent, 'harness/1.0.0');
  assert.equal(
    await fetchReleaseNotesPrompt({
      currentVersion: '1.0.0',
      previewLineCount: 2,
      maxReleases: 2,
      fetchImpl: noNewerFetch,
    }),
    null,
  );
});

void test('release notes state parser validates version and field shapes', () => {
  assert.deepEqual(
    parseReleaseNotesState({
      version: 1,
      neverShow: false,
      dismissedLatestTag: 'v1.2.3',
    }),
    {
      version: 1,
      neverShow: false,
      dismissedLatestTag: 'v1.2.3',
    },
  );
  assert.equal(
    parseReleaseNotesState({ version: 2, neverShow: false, dismissedLatestTag: null }),
    null,
  );
  assert.equal(
    parseReleaseNotesState({ version: 1, neverShow: 'no', dismissedLatestTag: null }),
    null,
  );
  assert.equal(
    parseReleaseNotesState({ version: 1, neverShow: false, dismissedLatestTag: 5 }),
    null,
  );
  assert.equal(parseReleaseNotesState(null), null);
  assert.equal(parseReleaseNotesState([]), null);
  assert.equal(parseReleaseNotesState('invalid'), null);
});

void test('release notes state read/write round trips and falls back safely', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-release-notes-state-'));
  try {
    const statePath = join(workspace, 'release-notes.json');
    assert.deepEqual(readReleaseNotesState(statePath), {
      version: 1,
      neverShow: false,
      dismissedLatestTag: null,
    });
    writeReleaseNotesState(statePath, {
      version: 1,
      neverShow: true,
      dismissedLatestTag: 'v2.0.0',
    });
    assert.deepEqual(readReleaseNotesState(statePath), {
      version: 1,
      neverShow: true,
      dismissedLatestTag: 'v2.0.0',
    });

    writeFileSync(statePath, '{"version":2,"neverShow":true,"dismissedLatestTag":null}\n', 'utf8');
    assert.deepEqual(readReleaseNotesState(statePath), {
      version: 1,
      neverShow: false,
      dismissedLatestTag: null,
    });
    writeFileSync(statePath, '{', 'utf8');
    assert.deepEqual(readReleaseNotesState(statePath), {
      version: 1,
      neverShow: false,
      dismissedLatestTag: null,
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('release notes state write rethrows filesystem errors after temp cleanup attempt', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-release-notes-write-error-'));
  try {
    const blockerPath = join(workspace, 'blocker');
    writeFileSync(blockerPath, 'not a directory\n', 'utf8');
    assert.throws(() => {
      writeReleaseNotesState(join(blockerPath, 'release-notes.json'), {
        version: 1,
        neverShow: false,
        dismissedLatestTag: null,
      });
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('release notes resolves runtime state path and installed package version', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-release-notes-path-'));
  try {
    const xdgConfigHome = join(workspace, '.xdg');
    const env: NodeJS.ProcessEnv = {
      XDG_CONFIG_HOME: xdgConfigHome,
    };
    mkdirSync(xdgConfigHome, { recursive: true });
    const statePath = resolveReleaseNotesStatePath('/tmp/harness-workspace', env);
    assert.equal(statePath.includes('release-notes.json'), true);
    const installedVersion = readInstalledHarnessVersion();
    assert.equal(installedVersion.length > 0, true);
    assert.equal(readInstalledHarnessVersion(join(workspace, 'missing-package.json')), '0.0.0');

    const invalidPackagePath = join(workspace, 'invalid-package.json');
    writeFileSync(invalidPackagePath, '{"name":"harness"}\n', 'utf8');
    assert.equal(readInstalledHarnessVersion(invalidPackagePath), '0.0.0');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
