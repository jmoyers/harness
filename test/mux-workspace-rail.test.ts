import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkspaceRailAnsiRows } from '../src/mux/workspace-rail.ts';

void test('workspace rail renders directory-wrapped conversations with inline git and telemetry', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness:worktree-local',
          workspaceId: 'harness',
          worktreeId: 'worktree-local',
          active: true,
          git: {
            branch: 'main',
            additions: 12,
            deletions: 3,
            changedFiles: 4
          }
        },
        {
          key: 'fernwatch:feature-ai',
          workspaceId: 'fernwatch',
          worktreeId: 'feature-ai',
          active: false,
          git: {
            branch: 'feature/ai',
            additions: 248,
            deletions: 89,
            changedFiles: 31
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-e9d45049-1111',
          directoryKey: 'harness:worktree-local',
          agentLabel: 'codex',
          worktreeLabel: 'fix-mux-render',
          cpuPercent: 0.2,
          memoryMb: 12,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          sessionId: 'conversation-4300cf78-2222',
          directoryKey: 'harness:worktree-local',
          agentLabel: 'codex',
          worktreeLabel: null,
          cpuPercent: null,
          memoryMb: 8,
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:20.000Z'
        },
        {
          sessionId: 'conversation-b8c9d0e1-3333',
          directoryKey: 'fernwatch:feature-ai',
          agentLabel: 'codex',
          worktreeLabel: '',
          cpuPercent: 0,
          memoryMb: 22,
          status: 'needs-input',
          attentionReason: 'approval',
          startedAt: '2026-01-01T00:02:40.000Z'
        }
      ],
      processes: [
        {
          key: 'proc-dev',
          directoryKey: 'fernwatch:feature-ai',
          label: 'npm run dev',
          cpuPercent: 3.4,
          memoryMb: 180,
          status: 'running'
        }
      ],
      activeConversationId: 'conversation-e9d45049-1111',
      nowMs: Date.parse('2026-01-01T00:03:00.000Z')
    },
    80,
    28
  );

  assert.equal(rows.length, 28);
  assert.equal(rows.some((row) => row.includes('📁 harness/worktree-local ─ main')), true);
  assert.equal(rows.some((row) => row.includes('+12 -3 │ 4 files')), true);
  assert.equal(rows.some((row) => row.includes('▸ ● e9d45049')), true);
  assert.equal(rows.some((row) => row.includes('🤖 codex RUN')), true);
  assert.equal(rows.some((row) => row.includes('🌿 fix-mux-render')), true);
  assert.equal(rows.some((row) => row.includes('○ 4300cf78')), true);
  assert.equal(rows.some((row) => row.includes('◐ b8c9d0e1 approval')), true);
  assert.equal(rows.some((row) => row.includes('┄ npm run dev')), true);
  assert.equal(rows.some((row) => row.includes('⚙ RUN')), true);
  assert.equal(rows.some((row) => row.includes('20s')), true);
  assert.equal(rows.some((row) => row.includes('⌨ shortcuts')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;255;48;5;24m')), true);
});

void test('workspace rail handles empty state truncation and tiny dimensions', () => {
  const emptyRows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    8,
    4
  );
  assert.equal(emptyRows.length, 4);
  assert.equal(emptyRows[0]?.includes('📁'), true);

  const narrowRows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'x:y',
          workspaceId: 'workspace-name',
          worktreeId: 'branch-name',
          active: false,
          git: {
            branch: 'topic',
            additions: 1,
            deletions: 2,
            changedFiles: 3
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-1234567890',
          directoryKey: 'x:y',
          agentLabel: 'codex',
          worktreeLabel: null,
          cpuPercent: 0,
          memoryMb: 0,
          status: 'exited',
          attentionReason: null,
          startedAt: 'bad-time'
        },
        {
          sessionId: 'conversation-12345678',
          directoryKey: 'x:y',
          agentLabel: 'codex',
          worktreeLabel: null,
          cpuPercent: 1.5,
          memoryMb: 3,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          sessionId: 'external-session-cccccccccccccccc',
          directoryKey: 'x:y',
          agentLabel: 'exec',
          worktreeLabel: null,
          cpuPercent: null,
          memoryMb: null,
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          sessionId: 'short-id',
          directoryKey: 'x:y',
          agentLabel: 'exec',
          worktreeLabel: null,
          cpuPercent: Number.NaN,
          memoryMb: Number.NaN,
          status: 'needs-input',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [
        {
          key: 'p',
          directoryKey: 'x:y',
          label: 'proc',
          cpuPercent: null,
          memoryMb: null,
          status: 'exited'
        }
      ],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:30.000Z')
    },
    1,
    10
  );
  assert.equal(narrowRows.length, 10);
  assert.equal(narrowRows.every((line) => line.length > 0), true);

  const truncatedRows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'z:k',
          workspaceId: 'workspace',
          worktreeId: 'branch',
          active: false,
          git: {
            branch: 'topic',
            additions: 10,
            deletions: 5,
            changedFiles: 2
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-aaaaaaaa-1111',
          directoryKey: 'z:k',
          agentLabel: 'codex',
          worktreeLabel: 'feature',
          cpuPercent: 1.2,
          memoryMb: 42,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z')
    },
    40,
    2
  );
  assert.equal(truncatedRows.length, 2);
});

void test('workspace rail covers fallback branches for nowMs and empty directory conversations', () => {
  const recentStartedAt = new Date(Date.now() - 5_000).toISOString();
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'a:b',
          workspaceId: 'alpha',
          worktreeId: 'beta',
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
          sessionId: 'conversation-xyzxyzxy-1111',
          directoryKey: 'a:b',
          agentLabel: 'codex',
          worktreeLabel: null,
          cpuPercent: null,
          memoryMb: null,
          status: 'exited',
          attentionReason: '   ',
          startedAt: recentStartedAt
        }
      ],
      processes: [],
      activeConversationId: null
    },
    64,
    6
  );
  assert.equal(rows.some((row) => row.includes('s')), true);

  const noConversationRows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'dir-only',
          workspaceId: 'solo',
          worktreeId: 'only',
          active: false,
          git: {
            branch: 'topic',
            additions: 1,
            deletions: 1,
            changedFiles: 1
          }
        }
      ],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    64,
    8
  );
  assert.equal(noConversationRows.some((row) => row.includes('(no conversations)')), true);
});
