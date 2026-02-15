import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkspaceRailAnsiRows } from '../src/mux/workspace-rail.ts';

void test('workspace rail renders directory-centric rows with title and status metadata', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness:local',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          active: true,
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
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:03:00.000Z')
    },
    100,
    18
  );

  assert.equal(rows.length, 18);
  assert.equal(rows.some((row) => row.includes('📁 ~/dev/harness ─ main')), true);
  assert.equal(rows.some((row) => row.includes('+12 -3 │ 4 files')), true);
  assert.equal(rows.some((row) => row.includes('codex - untitled task 1')), true);
  assert.equal(rows.some((row) => row.includes('● working')), true);
  assert.equal(rows.some((row) => row.includes('○ complete')), true);
  assert.equal(rows.some((row) => row.includes('⚙ npm run dev')), true);
  assert.equal(rows.some((row) => row.includes('running · 3.4% · 180MB')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;254;48;5;238m')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;245;49m│ \u001b[0;38;5;254;48;5;238m')), true);
  assert.equal(rows.some((row) => row.includes('conversation-a')), false);
});

void test('workspace rail keeps shortcuts pinned to bottom rows', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'harness',
          worktreeId: 'worktree-local',
          active: false,
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
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    64,
    6
  );

  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.includes('⌨ shortcuts'), true);
  assert.equal(rows[1]?.includes('ctrl+t new'), true);
  assert.equal(rows[5]?.includes('close directory'), true);
});

void test('workspace rail handles tiny row counts by showing shortcut tail', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    24,
    1
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('close directory'), true);
});
