import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionAtWorkspaceRailRow,
  buildWorkspaceRailViewRows,
  conversationIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow
} from '../src/mux/workspace-rail-model.ts';

void test('workspace rail model builds rows with conversation spacing and process metadata', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'a:b',
          workspaceId: 'alpha',
          worktreeId: 'worktree-local',
          active: false,
          git: {
            branch: 'main',
            additions: 4,
            deletions: 1,
            changedFiles: 2
          }
        },
        {
          key: 'c:d',
          workspaceId: 'charlie',
          worktreeId: 'worktree-local',
          active: false,
          git: {
            branch: 'feature/x',
            additions: 1,
            deletions: 0,
            changedFiles: 1
          }
        }
      ],
      conversations: [
        {
          sessionId: 's1',
          directoryKey: 'a:b',
          title: 'untitled task 1',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          status: 'needs-input',
          attentionReason: 'approval',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:09.000Z'
        },
        {
          sessionId: 's2',
          directoryKey: 'a:b',
          title: 'untitled task 2',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          status: 'exited',
          attentionReason: null,
          startedAt: 'bad-time',
          lastEventAt: null
        }
      ],
      processes: [
        {
          key: 'proc',
          directoryKey: 'a:b',
          label: 'npm run dev',
          cpuPercent: Number.NaN,
          memoryMb: Number.NaN,
          status: 'exited'
        }
      ],
      activeConversationId: 's1',
      nowMs: Date.parse('2026-01-01T00:00:10.000Z')
    },
    32
  );

  assert.equal(rows.length, 32);
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.active), true);
  assert.equal(rows.some((row) => row.kind === 'conversation-meta' && row.text.includes('needs action · approval')), true);
  assert.equal(rows.some((row) => row.kind === 'conversation-meta' && row.text.includes('◌ exited · · ·')), true);
  assert.equal(rows.some((row) => row.kind === 'process-meta' && row.text.includes('exited · · · ·')), true);
  assert.equal(rows.some((row) => row.kind === 'dir-header' && row.text.startsWith('├─ 📁 charlie')), true);
  assert.equal(rows.some((row) => row.kind === 'muted' && row.text.includes('(no conversations)')), true);
  assert.equal(rows.some((row) => row.kind === 'muted' && row.text === '│'), true);
  const secondDirectoryHeaderRowIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.startsWith('├─ 📁 charlie')
  );
  assert.equal(secondDirectoryHeaderRowIndex > 1, true);
  assert.equal(rows[secondDirectoryHeaderRowIndex - 1]?.kind, 'muted');
  assert.equal(rows[secondDirectoryHeaderRowIndex - 1]?.text, '│');
  assert.equal(rows[secondDirectoryHeaderRowIndex - 2]?.kind, 'muted');
  assert.equal(rows[secondDirectoryHeaderRowIndex - 2]?.text, '│');
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.conversationSessionId === 's1'), true);
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'shortcut-header' &&
        row.text.includes('shortcuts') &&
        row.railAction === 'shortcuts.toggle'
    ),
    true
  );
  assert.equal(rows.some((row) => row.kind === 'shortcut-body' && row.text.includes('ctrl+t')), true);
  assert.equal(rows[rows.length - 1]?.kind, 'action');
});

void test('workspace rail model handles empty directories and blank workspace name', () => {
  const noDirectoryRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    16
  );
  assert.equal(noDirectoryRows[0]?.text.includes('no directories'), true);

  const blankNameRows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'x:y',
          workspaceId: '   ',
          worktreeId: 'ignored',
          active: false,
          git: {
            branch: 'topic',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeConversationId: null
    },
    16
  );
  assert.equal(blankNameRows.some((row) => row.text.includes('(unnamed)')), true);
});

void test('workspace rail model truncates content before pinned shortcuts and supports two-row limit', () => {
  const twoRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null
    },
    2
  );
  assert.equal(twoRows.length, 2);
  assert.equal(twoRows[0]?.kind, 'action');
  assert.equal(twoRows[1]?.kind, 'action');
  assert.equal(twoRows[1]?.text.includes('close directory'), true);

  const truncated = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'dir',
          worktreeId: 'w',
          active: false,
          git: {
            branch: 'main',
            additions: 1,
            deletions: 2,
            changedFiles: 3
          }
        }
      ],
      conversations: [
        {
          sessionId: 'x',
          directoryKey: 'd',
          title: 'a',
          agentLabel: 'codex',
          cpuPercent: 1.2,
          memoryMb: 30,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:59.000Z'
        }
      ],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z')
    },
    3
  );
  assert.equal(truncated.length, 3);
  assert.equal(truncated[0]?.text.includes('archive conversation'), true);
  assert.equal(truncated[1]?.text.includes('add directory'), true);
  assert.equal(truncated[2]?.text.includes('close directory'), true);
});

void test('workspace rail model supports idle normalization custom shortcuts and row hit-testing', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          active: false,
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
          title: 'untitled',
          agentLabel: 'codex',
          cpuPercent: 0.1,
          memoryMb: 10,
          status: 'running',
          attentionReason: '   ',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeConversationId: 'conversation-a',
      shortcutHint: '   ',
      nowMs: Date.parse('2026-01-01T00:00:20.000Z')
    },
    20
  );

  assert.equal(rows.some((row) => row.text.includes('◍ idle')), true);
  assert.equal(rows.some((row) => row.text.includes('ctrl+j/k switch')), true);
  assert.equal(rows.some((row) => row.text.includes('x archive conversation')), true);
  assert.equal(rows.some((row) => row.text.includes('🗑 archive conversation')), false);
  assert.equal(rows.some((row) => row.text.includes('add directory')), true);
  const shortcutHeaderRowIndex = rows.findIndex((row) => row.kind === 'shortcut-header');
  assert.equal(shortcutHeaderRowIndex >= 0, true);
  const conversationRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-a'
  );
  assert.equal(conversationRowIndex >= 0, true);
  assert.equal(actionAtWorkspaceRailRow(rows, shortcutHeaderRowIndex), 'shortcuts.toggle');
  assert.equal(conversationIdAtWorkspaceRailRow(rows, conversationRowIndex), 'conversation-a');
  assert.equal(actionAtWorkspaceRailRow(rows, rows.length - 1), 'directory.close');
  assert.equal(conversationIdAtWorkspaceRailRow(rows, -1), null);
  assert.equal(conversationIdAtWorkspaceRailRow(rows, 100), null);
  assert.equal(actionAtWorkspaceRailRow(rows, -1), null);
  assert.equal(actionAtWorkspaceRailRow(rows, 100), null);
  assert.equal(kindAtWorkspaceRailRow(rows, conversationRowIndex), 'conversation-title');
  assert.equal(kindAtWorkspaceRailRow(rows, -1), null);
});

void test('workspace rail model overrides default shortcut text when custom hint is set', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      shortcutHint: 'ctrl+t new  ctrl+n/p switch  ctrl+] quit'
    },
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.text.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.text.includes('close directory')), true);
});

void test('workspace rail model supports newline-delimited shortcut hint rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      shortcutHint: 'ctrl+t new\nctrl+n/p switch\nctrl+c quit'
    },
    10
  );

  assert.equal(rows.some((row) => row.text.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.text.includes('ctrl+c quit')), true);
});

void test('workspace rail model treats running sessions with missing last event as working', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          active: false,
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
          sessionId: 'conversation-working',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 1,
          status: 'running',
          attentionReason: null,
          startedAt: 'bad-time',
          lastEventAt: null
        }
      ],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:20.000Z')
    },
    20
  );

  assert.equal(rows.some((row) => row.text.includes('● working')), true);
});

void test('workspace rail model supports collapsed shortcut descriptions with clickable toggle row', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      shortcutsCollapsed: true
    },
    10
  );

  assert.equal(rows.some((row) => row.kind === 'shortcut-header' && row.text.includes('[+]')), true);
  assert.equal(rows.some((row) => row.kind === 'shortcut-body'), false);
  const shortcutHeaderRowIndex = rows.findIndex((row) => row.kind === 'shortcut-header');
  assert.equal(actionAtWorkspaceRailRow(rows, shortcutHeaderRowIndex), 'shortcuts.toggle');
  assert.equal(rows.some((row) => row.kind === 'action' && row.text.includes('new conversation')), true);
});
