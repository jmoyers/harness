import assert from 'node:assert/strict';
import test from 'node:test';
import { findAnsiIntegrityIssues } from '../src/mux/ansi-integrity.ts';
import { padOrTrimDisplay } from '../src/mux/dual-pane-core.ts';
import { renderWorkspaceRailAnsiRows } from '../src/mux/workspace-rail.ts';

void test('ansi integrity checker accepts valid rail rows', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'main',
          workspaceId: 'harness',
          worktreeId: 'main',
          active: true,
          git: {
            branch: 'main',
            changedFiles: 0,
            additions: 0,
            deletions: 0
          }
        }
      ],
      conversations: [],
      activeConversationId: null,
      processes: [],
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    36,
    8
  );

  assert.deepEqual(findAnsiIntegrityIssues(rows), []);
});

void test('ansi integrity checker detects mangling from plain-width trimming ansi rows', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      activeConversationId: null,
      processes: [],
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    36,
    4
  );

  const mangled = rows.map((row) => padOrTrimDisplay(row, 4));
  const issues = findAnsiIntegrityIssues(mangled);
  assert.equal(issues.length > 0, true);
});

void test('ansi integrity checker reports dangling and unterminated escapes', () => {
  const issues = findAnsiIntegrityIssues([
    '\u001b[31mok\u001b[0m',
    '\u001b[31',
    '\u001b]10;rgb:ffff/ffff/ffff',
    'tail\u001b'
  ]);
  assert.equal(issues.length, 3);
  assert.equal(issues.some((issue) => issue.includes('unterminated CSI')), true);
  assert.equal(issues.some((issue) => issue.includes('unterminated OSC')), true);
  assert.equal(issues.some((issue) => issue.includes('dangling ESC')), true);
});

void test('ansi integrity checker accepts osc st terminators and two-byte escapes', () => {
  const issues = findAnsiIntegrityIssues([
    '\u001b]10;rgb:ffff/aaaa/1111\u001b\\ok',
    '\u001b]12;🙂\u0007ok',
    '\u001b]11;rgb:0000/0000/0000\u0007ok',
    '\u001bcreset',
    '\u001b[31mred\u001b[0m',
    'plain🙂text'
  ]);
  assert.deepEqual(issues, []);
});

void test('ansi integrity checker reports invalid csi bytes and sparse rows safely', () => {
  const sparseRows = [] as string[];
  sparseRows[1] = '\u001b[31\u2502m';
  const issues = findAnsiIntegrityIssues(sparseRows);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.includes('invalid CSI byte'), true);
});
