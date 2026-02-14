import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';

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
          startedAt: '2026-01-01T00:00:00.000Z'
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
          startedAt: 'bad-time'
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
    18
  );

  assert.equal(rows.length, 18);
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.active), true);
  assert.equal(rows.some((row) => row.kind === 'conversation-meta' && row.text.includes('needs input · approval')), true);
  assert.equal(rows.some((row) => row.kind === 'conversation-meta' && row.text.includes('◌ exited · · · ·')), true);
  assert.equal(rows.some((row) => row.kind === 'process-meta' && row.text.includes('exited · · · ·')), true);
  assert.equal(rows.some((row) => row.kind === 'dir-header' && row.text.startsWith('├─ 📁 charlie')), true);
  assert.equal(rows.some((row) => row.kind === 'muted' && row.text.includes('(no conversations)')), true);
  assert.equal(rows.some((row) => row.kind === 'empty'), true);
  assert.equal(rows[rows.length - 2]?.kind, 'shortcut-header');
  assert.equal(rows[rows.length - 1]?.kind, 'shortcut-body');
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
    5
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
    4
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
  assert.equal(twoRows[0]?.kind, 'shortcut-header');
  assert.equal(twoRows[1]?.kind, 'shortcut-body');

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
          startedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z')
    },
    3
  );
  assert.equal(truncated.length, 3);
  assert.equal(truncated[1]?.kind, 'shortcut-header');
  assert.equal(truncated[2]?.kind, 'shortcut-body');
});
