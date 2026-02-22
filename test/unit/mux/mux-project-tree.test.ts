import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { test } from 'bun:test';
import {
  buildProjectTreeLines,
  type ProjectTreeDirectoryEntry,
} from '../../../src/mux/project-tree.ts';

void test('project tree builds sorted hierarchy from git ls-files output', () => {
  let capturedArgs: readonly string[] | null = null;
  const lines = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: (_cwd, args) => {
      capturedArgs = args;
      return [
        'README.md',
        'docs/guide.md',
        'src/index.ts',
        'src/lib/util.ts',
        'src\\win.ts',
        '',
        '   ',
        './',
      ].join('\0');
    },
  });
  assert.deepEqual(capturedArgs, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  assert.deepEqual(lines, [
    'root/',
    '├─ docs/',
    '│  └─ guide.md',
    '├─ src/',
    '│  ├─ lib/',
    '│  │  └─ util.ts',
    '│  ├─ index.ts',
    '│  └─ win.ts',
    '└─ README.md',
  ]);
});

void test('project tree applies depth and entry limits to git-based tree output', () => {
  const lines = buildProjectTreeLines('/workspace/root', {
    maxDepth: 1,
    maxEntries: 2,
    runGitLsFiles: () => ['a/one.ts', 'b/two.ts', 'readme.md'].join('\0'),
  });
  assert.deepEqual(lines, ['root/', '├─ a/', '├─ b/', '└─ …']);
});

void test('project tree truncation propagates from nested git directories', () => {
  const lines = buildProjectTreeLines('/workspace/root', {
    maxEntries: 2,
    runGitLsFiles: () => ['a/one.ts', 'a/two.ts', 'b/three.ts'].join('\0'),
  });
  assert.deepEqual(lines, ['root/', '├─ a/', '│  ├─ one.ts', '└─ …']);
});

void test('project tree uses trailing-space recursion prefix when nested directory is last', () => {
  const gitLines = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: () => ['a/one.ts'].join('\0'),
  });
  assert.deepEqual(gitLines, ['root/', '└─ a/', '   └─ one.ts']);

  const fsLines = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: () => null,
    readDirectoryEntries: (path) => {
      if (path === '/workspace/root') {
        return [{ name: 'a', kind: 'directory' }];
      }
      if (path === '/workspace/root/a') {
        return [{ name: 'one.ts', kind: 'file' }];
      }
      return [];
    },
  });
  assert.deepEqual(fsLines, ['root/', '└─ a/', '   └─ one.ts']);
});

void test('project tree handles empty git listings and invalid numeric options safely', () => {
  const lines = buildProjectTreeLines('/workspace/root', {
    maxDepth: -1,
    maxEntries: 0,
    runGitLsFiles: () => '',
  });
  assert.deepEqual(lines, ['root/']);
});

void test('project tree falls back to root path label when basename is empty', () => {
  const lines = buildProjectTreeLines('/', {
    runGitLsFiles: () => '',
  });
  assert.deepEqual(lines, ['//']);
});

void test('project tree falls back to filesystem reader with skip filters and unreadable directories', () => {
  const entriesByPath = new Map<string, readonly ProjectTreeDirectoryEntry[]>([
    [
      '/workspace/root',
      [
        { name: 'src', kind: 'directory' },
        { name: 'skip-me', kind: 'directory' },
        { name: 'link', kind: 'symlink' },
        { name: 'readme.md', kind: 'file' },
      ],
    ],
    ['/workspace/root/skip-me', [{ name: 'nested.txt', kind: 'file' }]],
  ]);
  const lines = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: () => null,
    skipNames: ['skip-me'],
    readDirectoryEntries: (path) => {
      if (path === '/workspace/root/src') {
        throw new Error('denied');
      }
      return entriesByPath.get(path) ?? [];
    },
  });
  assert.deepEqual(lines, [
    'root/',
    '├─ src/',
    '│  └─ [unreadable: denied]',
    '├─ link@',
    '└─ readme.md',
  ]);

  const filteredBySet = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: () => null,
    skipNames: new Set<string>(['readme.md']),
    readDirectoryEntries: (path) => entriesByPath.get(path) ?? [],
  });
  assert.equal(filteredBySet.includes('└─ readme.md'), false);

  const nonErrorMessage = buildProjectTreeLines('/workspace/root', {
    runGitLsFiles: () => null,
    readDirectoryEntries: (path): readonly ProjectTreeDirectoryEntry[] => {
      if (path === '/workspace/root') {
        return runInNewContext('throw "string-error"') as never;
      }
      return [];
    },
  });
  assert.deepEqual(nonErrorMessage, ['root/', '└─ [unreadable: string-error]']);

  const depthLimited = buildProjectTreeLines('/workspace/root', {
    maxDepth: 0,
    runGitLsFiles: () => null,
    readDirectoryEntries: () => {
      throw new Error('should-not-read');
    },
  });
  assert.deepEqual(depthLimited, ['root/']);

  const entryLimited = buildProjectTreeLines('/workspace/root', {
    maxEntries: 1,
    runGitLsFiles: () => null,
    readDirectoryEntries: (path) => {
      if (path === '/workspace/root') {
        return [
          { name: 'a', kind: 'directory' },
          { name: 'b', kind: 'file' },
        ];
      }
      return [];
    },
  });
  assert.deepEqual(entryLimited, ['root/', '├─ a/', '└─ …']);

  const nestedEntryLimited = buildProjectTreeLines('/workspace/root', {
    maxEntries: 2,
    runGitLsFiles: () => null,
    readDirectoryEntries: (path) => {
      if (path === '/workspace/root') {
        return [
          { name: 'a', kind: 'directory' },
          { name: 'z', kind: 'file' },
        ];
      }
      if (path === '/workspace/root/a') {
        return [
          { name: 'one.txt', kind: 'file' },
          { name: 'two.txt', kind: 'file' },
        ];
      }
      return [];
    },
  });
  assert.deepEqual(nestedEntryLimited, ['root/', '├─ a/', '│  ├─ one.txt', '└─ …']);
});

void test('project tree default git path respects .gitignore patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-project-tree-git-'));
  try {
    writeFileSync(join(dir, '.gitignore'), '*.log\nbuild/\n', 'utf8');
    writeFileSync(join(dir, 'tracked.txt'), 'tracked\n', 'utf8');
    writeFileSync(join(dir, 'visible.txt'), 'visible\n', 'utf8');
    writeFileSync(join(dir, 'ignored.log'), 'ignored\n', 'utf8');
    mkdirSync(join(dir, 'build'), { recursive: true });
    writeFileSync(join(dir, 'build', 'output.txt'), 'build output\n', 'utf8');

    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: dir });

    const lines = buildProjectTreeLines(dir);
    assert.equal(lines.includes('├─ .gitignore') || lines.includes('└─ .gitignore'), true);
    assert.equal(lines.includes('├─ tracked.txt') || lines.includes('└─ tracked.txt'), true);
    assert.equal(lines.includes('├─ visible.txt') || lines.includes('└─ visible.txt'), true);
    assert.equal(lines.includes('ignored.log'), false);
    assert.equal(lines.includes('build/'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('project tree default filesystem fallback applies built-in skip names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-project-tree-fs-'));
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'skip.js'), 'skip\n', 'utf8');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), 'main\n', 'utf8');
    writeFileSync(join(dir, 'readme.md'), 'readme\n', 'utf8');
    symlinkSync(join(dir, 'src', 'main.ts'), join(dir, 'main-link.ts'));

    const lines = buildProjectTreeLines(dir);
    assert.equal(lines.includes('├─ node_modules/') || lines.includes('└─ node_modules/'), false);
    assert.equal(lines.includes('├─ src/') || lines.includes('└─ src/'), true);
    assert.equal(lines.includes('├─ main-link.ts@') || lines.includes('└─ main-link.ts@'), true);
    assert.equal(lines.includes('├─ readme.md') || lines.includes('└─ readme.md'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
