import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  renderWorkspaceRailAnsiRows as renderWorkspaceRailAnsiRowsRaw,
  renderWorkspaceRailRowAnsiForTest,
} from '../src/mux/workspace-rail.ts';
import { statusModelFor } from './support/status-model.ts';

type StrictWorkspaceRailModel = Parameters<typeof renderWorkspaceRailAnsiRowsRaw>[0];
type StrictWorkspaceConversation = StrictWorkspaceRailModel['conversations'][number];
type FixtureWorkspaceConversation = Omit<StrictWorkspaceConversation, 'statusModel'> & {
  statusModel?: StrictWorkspaceConversation['statusModel'];
};
type FixtureWorkspaceRailModel = Omit<StrictWorkspaceRailModel, 'conversations'> & {
  conversations: readonly FixtureWorkspaceConversation[];
};

function normalizeConversationFixture(
  value: FixtureWorkspaceConversation,
): StrictWorkspaceConversation {
  if (value.statusModel !== undefined && value.statusModel !== null) {
    return value as StrictWorkspaceConversation;
  }
  const status = value.status ?? 'completed';
  const lastKnownWork = value.lastKnownWork ?? null;
  const attentionReason = value.attentionReason;
  const lastKnownWorkAt = value.lastKnownWorkAt ?? null;
  const detailLower = (lastKnownWork ?? '').toLowerCase();
  const phase =
    status === 'needs-input'
      ? 'needs-action'
      : status === 'exited'
        ? 'exited'
        : detailLower === 'active' ||
            detailLower === 'working' ||
            detailLower.startsWith('working:')
          ? 'working'
          : detailLower === 'inactive' ||
              detailLower.includes('turn complete') ||
              detailLower.includes('turn completed')
            ? 'idle'
            : status === 'running'
              ? 'starting'
              : 'idle';
  const modelOptions: NonNullable<Parameters<typeof statusModelFor>[1]> = {
    attentionReason,
    phase,
    lastKnownWork,
    lastKnownWorkAt,
    activityHint: phase === 'needs-action' || phase === 'working' || phase === 'idle' ? phase : null,
  };
  if (lastKnownWork !== null || attentionReason !== null) {
    modelOptions.detailText = (lastKnownWork ?? attentionReason) as string;
  }
  if (lastKnownWorkAt !== null) {
    modelOptions.observedAt = lastKnownWorkAt;
  } else if (value.lastEventAt !== null) {
    modelOptions.observedAt = value.lastEventAt;
  }
  return {
    ...value,
    statusModel: statusModelFor(status, modelOptions),
  };
}

function renderWorkspaceRailAnsiRows(
  model: FixtureWorkspaceRailModel,
  width: number,
  rows: number,
): ReturnType<typeof renderWorkspaceRailAnsiRowsRaw> {
  return renderWorkspaceRailAnsiRowsRaw(
    {
      ...model,
      conversations: model.conversations.map((entry) => normalizeConversationFixture(entry)),
    },
    width,
    rows,
  );
}

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
            changedFiles: 4,
          },
        },
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
          lastEventAt: '2026-01-01T00:02:59.000Z',
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
          lastEventAt: '2026-01-01T00:02:50.000Z',
        },
      ],
      processes: [
        {
          key: 'proc-dev',
          directoryKey: 'harness:local',
          label: 'bun run dev',
          cpuPercent: 3.4,
          memoryMb: 180,
          status: 'running',
        },
      ],
      activeProjectId: 'harness:local',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      nowMs: Date.parse('2026-01-01T00:03:00.000Z'),
    },
    100,
    25,
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  assert.equal(rows.length, 25);
  assert.equal(
    plainRows.some((row) => row.includes('📁 ~/dev/harness')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('codex - untitled task 1')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('◔ codex - untitled task 1')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('○ codex - untitled task 2')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('starting')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('⚙ bun run dev')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('running · 3.4% · 180MB')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('[+ thread]')),
    true,
  );
  const addProjectRow = rows.find((row) => row.includes('[ > add project ]'));
  assert.notEqual(addProjectRow, undefined);
  assert.equal(addProjectRow?.includes('\u001b[0;38;5;245;49m│'), true);
  assert.equal(addProjectRow?.includes('\u001b[0;38;5;230;48;5;237m[ > add project ]'), true);
  const addProjectRowPlain = stripAnsi(addProjectRow ?? '');
  assert.equal(addProjectRowPlain.trimStart().startsWith('│'), true);
  assert.equal(addProjectRowPlain.includes('[ > add project ]'), true);
  assert.equal(addProjectRowPlain.indexOf('[ > add project ]') > 35, true);
  const homeRow = rows.find((row) => row.includes('🏠 home'));
  assert.notEqual(homeRow, undefined);
  assert.equal(homeRow?.includes('38;5;254'), true);
  assert.equal(homeRow?.includes('\u001b[0;38;5;230;48;5;237m[ ⌂ home ]'), false);
  const threadButtonRow = rows.find((row) => row.includes('[+ thread]'));
  assert.notEqual(threadButtonRow, undefined);
  assert.equal(threadButtonRow?.includes('\u001b[0;38;5;230;48;5;237m[+ thread]'), true);
  const threadButtonRowPlain = stripAnsi(threadButtonRow ?? '');
  assert.equal(threadButtonRowPlain.endsWith('[+ thread]'), true);
  assert.equal(threadButtonRowPlain.trimEnd().endsWith('[+ thread]'), true);
  assert.equal(threadButtonRowPlain.indexOf('[+ thread]') > 20, true);
  assert.equal(
    rows.some((row) => row.includes('conversation-a')),
    false,
  );
});

void test('workspace rail render keeps explicit completion text stable despite newer event timestamps', () => {
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
            changedFiles: 0,
          },
        },
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
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:03.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:04.000Z'),
    },
    80,
    22,
  ).map((row) => stripAnsi(row));
  assert.equal(
    completeRows.some((row) => row.includes('○ codex - task')),
    true,
  );
  assert.equal(
    completeRows.some((row) => row.includes('turn complete (812ms)')),
    true,
  );

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
            changedFiles: 0,
          },
        },
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
          lastEventAt: '2026-01-01T00:00:08.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:09.000Z'),
    },
    80,
    22,
  ).map((row) => stripAnsi(row));
  assert.equal(
    workingRows.some((row) => row.includes('○ codex - task')),
    true,
  );
  assert.equal(
    workingRows.some((row) => row.includes('turn complete (812ms)')),
    true,
  );
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
            changedFiles: 0,
          },
        },
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
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-empty-title',
      nowMs: Date.parse('2026-01-01T00:00:03.000Z'),
    },
    80,
    20,
  );

  assert.equal(
    rows.some((row) => row.includes('codex - ')),
    false,
  );
  assert.equal(
    rows.some((row) => row.includes('codex')),
    true,
  );
});

void test('workspace rail keeps navigation and project action rows when vertical list is truncated', () => {
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
            changedFiles: 0,
          },
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    64,
    6,
  );

  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.includes('home'), true);
  assert.equal(rows[1]?.includes('tasks'), true);
  assert.equal(rows[2]?.includes('untracked'), true);
  assert.equal(rows[3]?.includes('add project'), true);
  assert.equal(rows[4]?.includes('harness'), true);
});

void test('workspace rail renders icon colors for needs-action exited starting and idle states', () => {
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
            changedFiles: 0,
          },
        },
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
          lastEventAt: '2026-01-01T00:00:01.000Z',
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
          lastEventAt: null,
        },
        {
          sessionId: 'idle',
          directoryKey: 'd',
          title: 'stale',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: null,
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z',
        },
        {
          sessionId: 'starting',
          directoryKey: 'd',
          title: 'booting',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'starting',
          lastKnownWorkAt: '2026-01-01T00:01:00.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:01:00.000Z',
        },
        {
          sessionId: 'working',
          directoryKey: 'd',
          title: 'streaming',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'working: writing',
          lastKnownWorkAt: '2026-01-01T00:01:00.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:01:00.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z'),
    },
    80,
    32,
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  assert.equal(
    plainRows.some((row) => row.includes('▲ codex - approval')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('■ codex - stopped')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('◔ codex - booting')),
    true,
  );
  assert.equal(
    plainRows.some((row) => row.includes('○ codex - stale')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;220;49m▲')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;196;49m■')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('\u001b[0;38;5;110;49m◔')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('38;5;245') && row.includes('○')),
    true,
  );
});

void test('workspace rail handles tiny row counts by preserving add-project action row', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    24,
    1,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('add project'), true);
});

void test('workspace rail keeps full height and does not render shortcut hint section', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    40,
    8,
  );

  assert.equal(rows.length, 8);
  assert.equal(
    rows.some((row) => row.includes('home')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('tasks')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('add project')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('shortcuts')),
    false,
  );
});

void test('workspace rail renders no-project header without inline thread action button styling', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    48,
    20,
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  const noProjectsRowIndex = plainRows.findIndex((row) => row.includes('no projects'));
  assert.equal(noProjectsRowIndex >= 0, true);
  const noProjectsRow = rows[noProjectsRowIndex] ?? '';
  assert.equal(noProjectsRow.includes('[+ thread]'), false);
  assert.equal(noProjectsRow.includes('\u001b[0;38;5;230;48;5;237m[+ thread]'), false);
});

void test('workspace rail omits shortcut section while retaining add-project action row', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    40,
    8,
  );

  const plainRows = rows.map((row) => stripAnsi(row));
  assert.equal(rows.length, 8);
  assert.equal(
    plainRows.some((row) => row.includes('shortcuts')),
    false,
  );
  assert.equal(
    plainRows.some((row) => row.includes('add project')),
    true,
  );
});

void test('workspace rail omits repository section rows and actions', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      repositories: [
        {
          repositoryId: 'repository-1',
          name: 'harness',
          remoteUrl: 'https://github.com/jmoyers/harness.git',
          associatedProjectCount: 1,
          commitCount: 10,
          lastCommitAt: '2026-01-01T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      repositoriesCollapsed: false,
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:30:00.000Z'),
    },
    96,
    14,
  ).map((row) => stripAnsi(row));

  assert.equal(
    rows.some((row) => row.includes('repositories [-]')),
    false,
  );
  assert.equal(
    rows.some((row) => row.includes('add repository')),
    false,
  );
  assert.equal(
    rows.some((row) => row.includes('archive repository')),
    false,
  );
});

void test('workspace rail row renderer tolerates malformed action and null-status title rows', () => {
  const malformedActionRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'action',
      text: '│  add project',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'project.add',
      conversationStatus: null,
    },
    32,
  );
  assert.equal(stripAnsi(malformedActionRowAnsi).includes('add project'), true);

  const genericActionRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'action',
      text: '│  [home]',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'home.open',
      conversationStatus: null,
    },
    24,
  );
  assert.equal(stripAnsi(genericActionRowAnsi).includes('[home]'), true);

  const nullStatusTitleRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'conversation-title',
      text: '│    ◆ codex - edge',
      active: false,
      conversationSessionId: 'edge',
      directoryKey: 'd',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    32,
  );
  assert.equal(stripAnsi(nullStatusTitleRowAnsi).includes('◆ codex - edge'), true);
});

void test('workspace rail row renderer paints repository header and row styles for compatibility branches', () => {
  const repositoryHeaderRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'repository-header',
      text: '├─ ⎇ repositories [-]',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'repositories.toggle',
      conversationStatus: null,
    },
    40,
  );
  assert.equal(stripAnsi(repositoryHeaderRowAnsi).includes('repositories [-]'), true);

  const repositoryRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'repository-row',
      text: '│  ⎇ harness · 1 project · 10 commits · 1h ago · abc1234',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: 'repository-1',
      railAction: 'repository.edit',
      conversationStatus: null,
    },
    64,
  );
  assert.equal(stripAnsi(repositoryRowAnsi).includes('harness'), true);
});

void test('workspace rail row renderer covers header rows without collapse button labels', () => {
  const repositoryHeaderNoButtonAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'repository-header',
      text: '├─ 📁 harness (1 projects, 0 active)',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: 'repository-1',
      railAction: 'repository.toggle',
      conversationStatus: null,
    },
    48,
  );
  assert.equal(
    stripAnsi(repositoryHeaderNoButtonAnsi).includes('harness (1 projects, 0 active)'),
    true,
  );

  const homeHeaderNoButtonAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-header',
      text: '├─ 🏠 home',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'home.open',
      conversationStatus: null,
    },
    32,
  );
  assert.equal(stripAnsi(homeHeaderNoButtonAnsi).includes('home'), true);
});

void test('workspace rail row renderer covers active project rows muted rows and zero-width clamp', () => {
  const activeHeaderRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-header',
      text: '├─ 📁 ~/dev/harness ─ main  [+ thread]',
      active: true,
      conversationSessionId: null,
      directoryKey: 'harness:local',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    64,
  );
  assert.equal(activeHeaderRowAnsi.includes('48;5;237m'), true);

  const activeMetaRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-meta',
      text: '│  (main:+12,-3)',
      active: true,
      conversationSessionId: null,
      directoryKey: 'harness:local',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    64,
  );
  assert.equal(activeMetaRowAnsi.includes('48;5;237m'), true);

  const mutedRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'muted',
      text: '│',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    8,
  );
  assert.equal(stripAnsi(mutedRowAnsi).startsWith('│'), true);

  const zeroWidthMutedRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'muted',
      text: '│',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    0,
  );
  assert.equal(stripAnsi(zeroWidthMutedRowAnsi), '│');
});

void test('workspace rail row renderer keeps tasks nav spacing after emoji', () => {
  const tasksRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'dir-header',
      text: '├─ 🗂️ tasks',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'tasks.open',
      conversationStatus: null,
    },
    32,
  );
  assert.equal(stripAnsi(tasksRowAnsi).includes('🗂️ tasks'), true);
});

void test('workspace rail row renderer keeps title rows without status glyph unchanged', () => {
  const noGlyphTitleRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'conversation-title',
      text: '│    codex - no glyph',
      active: false,
      conversationSessionId: 'no-glyph',
      directoryKey: 'd',
      repositoryId: null,
      railAction: null,
      conversationStatus: 'idle',
    },
    40,
  );
  assert.equal(stripAnsi(noGlyphTitleRowAnsi).includes('codex - no glyph'), true);
});

void test('workspace rail row renderer paints working status icon style for thread rows', () => {
  const workingRowAnsi = renderWorkspaceRailRowAnsiForTest(
    {
      kind: 'conversation-title',
      text: '│    ◆ codex - working',
      active: false,
      conversationSessionId: 'working-row',
      directoryKey: 'd',
      repositoryId: null,
      railAction: null,
      conversationStatus: 'working',
    },
    48,
  );
  assert.equal(stripAnsi(workingRowAnsi).includes('◆ codex - working'), true);
  assert.equal(workingRowAnsi.includes('38;5;45'), true);
});
