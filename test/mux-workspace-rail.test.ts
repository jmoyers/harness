import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkspaceRailAnsiRows, renderWorkspaceRailRowAnsiForTest } from '../src/mux/workspace-rail.ts';

function stripAnsi(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (char === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      if (index < value.length) {
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

void test('workspace rail renders project-centric rows with icon-only thread states', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness:local',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 12,
            deletions: 3,
            changedFiles: 4
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-a',
          directoryKey: 'harness:local',
          title: 'untitled task 1',
          agentLabel: 'codex',
          cpuPercent: 0.2,
          memoryMb: 12,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:02:59.000Z'
        },
        {
          sessionId: 'conversation-b',
          directoryKey: 'harness:local',
          title: 'untitled task 2',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: 8,
          lastKnownWork: null,
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:02:40.000Z',
          lastEventAt: '2026-01-01T00:02:50.000Z'
        }
      ],
      processes: [
        {
          key: 'proc-dev',
          directoryKey: 'harness:local',
          label: 'npm run dev',
          cpuPercent: 3.4,
          memoryMb: 180,
          status: 'running'
        }
      ],
      activeProjectId: 'harness:local',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      nowMs: Date.parse('2026-01-01T00:03:00.000Z')
    },
    100,
    24
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  assert.equal(rows.length, 24);
  assert.equal(plainRows.some((row) => row.includes('📁 ~/dev/harness ─ main')), true);
  assert.equal(plainRows.some((row) => row.includes('+12 -3 │ 4 files')), true);
  assert.equal(plainRows.some((row) => row.includes('codex - untitled task 1')), true);
  assert.equal(plainRows.some((row) => row.includes('◆ codex - untitled task 1')), true);
  assert.equal(plainRows.some((row) => row.includes('◇ codex - untitled task 2')), true);
  assert.equal(plainRows.some((row) => row.includes('working · 0.2% · 12MB')), true);
  assert.equal(plainRows.some((row) => row.includes('⚙ npm run dev')), true);
  assert.equal(plainRows.some((row) => row.includes('running · 3.4% · 180MB')), true);
  assert.equal(rows.some((row) => row.includes('[+ thread]')), true);
  assert.equal(
    rows.some((row) => row.includes('📁 ~/dev/harness ─ main') && row.includes('48;5;238m')),
    false
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;245;48;5;237m│ \u001b[0;38;5;254;48;5;237m')),
    true
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;245;49m│ \u001b[0;38;5;254;48;5;237m')),
    false
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;245;48;5;238m│ \u001b[0;38;5;254;48;5;238m')),
    false
  );
  const addProjectRow = rows.find((row) => row.includes('[ > add project ]'));
  assert.notEqual(addProjectRow, undefined);
  assert.equal(addProjectRow?.includes('\u001b[0;38;5;245;49m│  '), true);
  assert.equal(addProjectRow?.includes('\u001b[0;38;5;230;48;5;237m[ > add project ]'), true);
  assert.equal(addProjectRow?.includes('\u001b[0;38;5;245;48;5;237m│  '), false);
  const threadButtonRow = rows.find((row) => row.includes('[+ thread]'));
  assert.notEqual(threadButtonRow, undefined);
  assert.equal(threadButtonRow?.includes('\u001b[0;38;5;230;48;5;237m[+ thread]'), true);
  const threadButtonRowPlain = stripAnsi(threadButtonRow ?? '');
  assert.equal(threadButtonRowPlain.trimEnd().endsWith('[+ thread]'), true);
  assert.equal(threadButtonRowPlain.indexOf('[+ thread]') > 60, true);
  assert.equal(rows.some((row) => row.includes('conversation-a')), false);
});

void test('workspace rail render transitions from complete telemetry to active working state with newer events', () => {
  const completeRows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-a',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0.4,
          memoryMb: 16,
          lastKnownWork: 'turn complete (812ms)',
          lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:03.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:04.000Z')
    },
    80,
    16
  ).map((row) => stripAnsi(row));
  assert.equal(completeRows.some((row) => row.includes('◇ codex - task')), true);
  assert.equal(completeRows.some((row) => row.includes('turn complete (812ms)')), true);

  const workingRows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-a',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0.4,
          memoryMb: 16,
          lastKnownWork: 'turn complete (812ms)',
          lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:08.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:09.000Z')
    },
    80,
    16
  ).map((row) => stripAnsi(row));
  assert.equal(workingRows.some((row) => row.includes('◆ codex - task')), true);
  assert.equal(workingRows.some((row) => row.includes('turn complete (812ms)')), false);
  assert.equal(workingRows.some((row) => row.includes('working · 0.4% · 16MB')), true);
});

void test('workspace rail renders no-title conversations without dash separator', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness:local',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-empty-title',
          directoryKey: 'harness:local',
          title: '',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-empty-title',
      nowMs: Date.parse('2026-01-01T00:00:03.000Z')
    },
    80,
    16
  );

  assert.equal(rows.some((row) => row.includes('codex - ')), false);
  assert.equal(rows.some((row) => row.includes('codex')), true);
});

void test('workspace rail keeps shortcut actions pinned to bottom rows when vertical list is truncated', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    64,
    6
  );

  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.includes('ctrl+x archive thread'), true);
  assert.equal(rows[1]?.includes('ctrl+l take over thread'), true);
  assert.equal(rows[4]?.includes('ctrl+j/k switch thread'), true);
  assert.equal(rows[5]?.includes('ctrl+c quit mux'), true);
});

void test('workspace rail renders icon colors for needs-action exited and idle states', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'harness',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'needs-action',
          directoryKey: 'd',
          title: 'approval',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 1,
          lastKnownWork: null,
          status: 'needs-input',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z'
        },
        {
          sessionId: 'exited',
          directoryKey: 'd',
          title: 'stopped',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: null,
          status: 'exited',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null
        },
        {
          sessionId: 'idle',
          directoryKey: 'd',
          title: 'stale',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z')
    },
    80,
    24
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  assert.equal(plainRows.some((row) => row.includes('▲ codex - approval')), true);
  assert.equal(plainRows.some((row) => row.includes('■ codex - stopped')), true);
  assert.equal(plainRows.some((row) => row.includes('○ codex - stale')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;220;49m▲')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;196;49m■')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;245;49m○')), true);
});

void test('workspace rail handles tiny row counts by showing shortcut tail', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    24,
    1
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('ctrl+c quit mux'), true);
});

void test('workspace rail keeps full height when shortcut hint text is provided', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      shortcutHint: 'ctrl+t new  ctrl+n/p switch  ctrl+c quit',
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    40,
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.includes('add project')), true);
});

void test('workspace rail renders no-project header without inline thread action button styling', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    48,
    12
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  const noProjectsRowIndex = plainRows.findIndex((row) => row.includes('no projects'));
  assert.equal(noProjectsRowIndex >= 0, true);
  const noProjectsRow = rows[noProjectsRowIndex] ?? '';
  assert.equal(noProjectsRow.includes('[+ thread]'), false);
  assert.equal(noProjectsRow.includes('\u001b[0;38;5;230;48;5;237m[+ thread]'), false);
});

void test('workspace rail collapses shortcut descriptions while retaining toggle header and actions', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      shortcutsCollapsed: true,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    40,
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.includes('shortcuts [+]')), true);
  assert.equal(rows.some((row) => row.includes('ctrl+t new thread')), false);
  assert.equal(rows.some((row) => row.includes('add project')), true);
});

void test('workspace rail row renderer tolerates malformed action and null-status title rows', () => {
  const malformedActionRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'action',
      text: '│  add project',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      railAction: 'project.add',
      conversationStatus: null
    },
    32
  );
  assert.equal(stripAnsi(malformedActionRowAnsi).includes('add project'), true);

  const nullStatusTitleRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'conversation-title',
      text: '│    ◆ codex - edge',
      active: false,
      conversationSessionId: 'edge',
      directoryKey: 'd',
      railAction: null,
      conversationStatus: null
    },
    32
  );
  assert.equal(stripAnsi(nullStatusTitleRowAnsi).includes('◆ codex - edge'), true);
});

void test('workspace rail row renderer covers active project rows muted rows and zero-width clamp', () => {
  const activeHeaderRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-header',
      text: '├─ 📁 ~/dev/harness ─ main  [+ thread]',
      active: true,
      conversationSessionId: null,
      directoryKey: 'harness:local',
      railAction: null,
      conversationStatus: null
    },
    64
  );
  assert.equal(activeHeaderRowAnsi.includes('48;5;238m'), true);

  const activeMetaRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-meta',
      text: '│  +12 -3 │ 4 files',
      active: true,
      conversationSessionId: null,
      directoryKey: 'harness:local',
      railAction: null,
      conversationStatus: null
    },
    64
  );
  assert.equal(activeMetaRowAnsi.includes('38;5;153;48;5;238m'), true);

  const mutedRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'muted',
      text: '│',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      railAction: null,
      conversationStatus: null
    },
    8
  );
  assert.equal(stripAnsi(mutedRowAnsi).startsWith('│'), true);

  const zeroWidthMutedRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'muted',
      text: '│',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      railAction: null,
      conversationStatus: null
    },
    0
  );
  assert.equal(stripAnsi(zeroWidthMutedRowAnsi), '│');
});
