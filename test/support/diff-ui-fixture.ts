import type { NormalizedDiff } from '../../src/diff/types.ts';

export function createSampleDiff(options: { readonly truncated?: boolean } = {}): NormalizedDiff {
  const truncated = options.truncated ?? false;
  return {
    spec: {
      diffId: 'diff-sample',
      mode: 'unstaged',
      baseRef: null,
      headRef: null,
      generatedAt: '2026-02-20T00:00:00.000Z',
    },
    files: [
      {
        fileId: 'file-a',
        changeType: 'modified',
        oldPath: 'src/a.ts',
        newPath: 'src/a.ts',
        language: 'typescript',
        isBinary: false,
        isGenerated: false,
        isTooLarge: false,
        additions: 1,
        deletions: 1,
        hunks: [
          {
            hunkId: 'hunk-a',
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 3,
            header: '@@ -1,3 +1,3 @@',
            lines: [
              {
                kind: 'context',
                oldLine: 1,
                newLine: 1,
                text: 'const a = 1;',
              },
              {
                kind: 'del',
                oldLine: 2,
                newLine: null,
                text: 'const b = 2;',
              },
              {
                kind: 'add',
                oldLine: null,
                newLine: 2,
                text: 'const b = 3;',
              },
            ],
            lineCount: 3,
            addCount: 1,
            delCount: 1,
          },
        ],
      },
      {
        fileId: 'file-b',
        changeType: 'added',
        oldPath: null,
        newPath: 'README.md',
        language: 'markdown',
        isBinary: false,
        isGenerated: false,
        isTooLarge: false,
        additions: 1,
        deletions: 0,
        hunks: [
          {
            hunkId: 'hunk-b',
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 1,
            header: '@@ -0,0 +1 @@',
            lines: [
              {
                kind: 'add',
                oldLine: null,
                newLine: 1,
                text: '# hello',
              },
            ],
            lineCount: 1,
            addCount: 1,
            delCount: 0,
          },
        ],
      },
    ],
    totals: {
      filesChanged: 2,
      additions: 2,
      deletions: 1,
      binaryFiles: 0,
      generatedFiles: 0,
      hunks: 2,
      lines: 4,
    },
    coverage: {
      complete: !truncated,
      truncated,
      skippedFiles: truncated ? 1 : 0,
      truncatedFiles: truncated ? 1 : 0,
      reason: truncated ? 'max-files' : 'none',
    },
  };
}
