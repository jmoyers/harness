import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  actionAtWorkspaceRailCell,
  actionAtWorkspaceRailRow,
  buildWorkspaceRailViewRows as buildWorkspaceRailViewRowsRaw,
  conversationIdAtWorkspaceRailRow,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow,
} from '../../../src/mux/workspace-rail-model.ts';
import { statusModelFor } from '../../support/status-model.ts';

type StrictWorkspaceRailModel = Parameters<typeof buildWorkspaceRailViewRowsRaw>[0];
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
  const attentionReason = value.attentionReason;
  const lastKnownWork = value.lastKnownWork ?? null;
  const lastKnownWorkAt = value.lastKnownWorkAt ?? null;
  const detailLower = lastKnownWork?.toLowerCase() ?? '';
  const phase =
    status === 'needs-input'
      ? 'needs-action'
      : status === 'exited'
        ? 'exited'
        : detailLower.includes('needs input') ||
            detailLower.includes('needs-input') ||
            detailLower.includes('attention-required') ||
            detailLower.includes('attention required') ||
            detailLower.includes('approval denied')
          ? 'needs-action'
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
    activityHint:
      phase === 'needs-action' || phase === 'working' || phase === 'idle' ? phase : null,
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

function normalizeModelFixture(value: FixtureWorkspaceRailModel): StrictWorkspaceRailModel {
  const conversations = value.conversations.map((entry) => normalizeConversationFixture(entry));
  return {
    ...value,
    conversations,
  };
}

function buildWorkspaceRailViewRows(
  model: FixtureWorkspaceRailModel,
  rows: number,
): ReturnType<typeof buildWorkspaceRailViewRowsRaw> {
  return buildWorkspaceRailViewRowsRaw(normalizeModelFixture(model), rows);
}

void test('workspace rail model builds rows with conversation spacing and process metadata', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'a:b',
          workspaceId: 'alpha',
          worktreeId: 'worktree-local',
          git: {
            branch: 'main',
            additions: 4,
            deletions: 1,
            changedFiles: 2,
          },
        },
        {
          key: 'c:d',
          workspaceId: 'charlie',
          worktreeId: 'worktree-local',
          git: {
            branch: 'feature/x',
            additions: 1,
            deletions: 0,
            changedFiles: 1,
          },
        },
      ],
      conversations: [
        {
          sessionId: 's1',
          directoryKey: 'a:b',
          title: 'untitled task 1',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'needs-input',
          attentionReason: 'approval',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:09.000Z',
        },
        {
          sessionId: 's2',
          directoryKey: 'a:b',
          title: 'untitled task 2',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: null,
          status: 'exited',
          attentionReason: null,
          startedAt: 'bad-time',
          lastEventAt: null,
        },
      ],
      processes: [
        {
          key: 'proc',
          directoryKey: 'a:b',
          label: 'bun run dev',
          cpuPercent: Number.NaN,
          memoryMb: Number.NaN,
          status: 'exited',
        },
      ],
      activeProjectId: null,
      activeConversationId: 's1',
      nowMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
    32,
  );

  assert.equal(rows.length, 32);
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.active),
    true,
  );
  assert.equal(
    rows.some(
      (row) => row.kind === 'conversation-title' && row.text.includes('▲ codex - untitled task 1'),
    ),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'conversation-body' && row.text.includes('approval')),
    true,
  );
  assert.equal(
    rows.some(
      (row) => row.kind === 'conversation-title' && row.text.includes('■ codex - untitled task 2'),
    ),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'process-meta' && row.text.includes('exited · · · ·')),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'dir-header' && row.text.includes('📁 charlie')),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'dir-header' && row.text.includes('[+ thread]')),
    true,
  );
  assert.equal(
    rows.some((row) => row.text.includes('(no conversations)')),
    false,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-header' && row.text.includes('untracked')),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.conversationSessionId === 's1'),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'action' && row.text.includes('add project')),
    true,
  );
  assert.equal(rows[0]?.railAction, 'home.open');
  const addProjectRowIndex = rows.findIndex((row) => row.railAction === 'project.add');
  assert.equal(addProjectRowIndex >= 0, true);
  assert.equal(
    rows.some((row) => row.text.includes('shortcuts')),
    false,
  );
});

void test('workspace rail model handles empty projects and blank workspace name', () => {
  const noDirectoryRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    40,
  );
  assert.equal(
    noDirectoryRows.some((row) => row.text.includes('no projects')),
    true,
  );
  assert.equal(noDirectoryRows[0]?.railAction, 'home.open');
  const noDirectoryAddProjectRowIndex = noDirectoryRows.findIndex(
    (row) => row.railAction === 'project.add',
  );
  assert.equal(noDirectoryAddProjectRowIndex >= 0, true);
  assert.equal(
    noDirectoryRows.some((row) => row.text.includes('shortcuts')),
    false,
  );

  const blankNameRows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'x:y',
          workspaceId: '   ',
          worktreeId: 'ignored',
          git: {
            branch: 'topic',
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
    },
    40,
  );
  assert.equal(
    blankNameRows.some((row) => row.text.includes('(unnamed)')),
    true,
  );
});

void test('workspace rail model can hide repository and task controls from the rail', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      showTaskPlanningUi: false,
      repositories: [
        {
          repositoryId: 'repository-1',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 42,
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
      nowMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
    18,
  );

  assert.equal(
    rows.some((row) => row.kind === 'repository-header'),
    false,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-row'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repository.add'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'home.open'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'project.add'),
    true,
  );
});

void test('workspace rail model can hide the tasks entry while keeping home visible', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      showTaskPlanningUi: true,
      showTasksEntry: false,
      repositories: [],
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
    18,
  );

  assert.equal(
    rows.some((row) => row.railAction === 'home.open'),
    true,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'tasks.open'),
    false,
  );
});

void test('workspace rail model formats finite process stats without repository rail rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
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
      processes: [
        {
          key: 'proc-1',
          directoryKey: 'dir',
          label: 'vite dev',
          cpuPercent: 12.34,
          memoryMb: 42.6,
          status: 'running',
        },
      ],
      activeProjectId: null,
      activeConversationId: null,
    },
    24,
  );

  assert.equal(
    rows.some((row) => row.kind === 'process-meta' && row.text.includes('12.3% · 43MB')),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-header'),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-row'),
    false,
  );
  assert.equal(
    rows.some((row) => row.text.includes('repositories [-]')),
    false,
  );
});

void test('workspace rail model ignores repository collapse flags in rail rendering', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      repositoriesCollapsed: true,
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    13,
  );

  assert.equal(
    rows.some((row) => row.kind === 'repository-header'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repositories.toggle'),
    false,
  );
});

void test('workspace rail model makes project header thread action clickable', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
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
    },
    26,
  );

  const emptyStateActionRowIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('[+ thread]'),
  );
  assert.equal(emptyStateActionRowIndex >= 0, true);
  const buttonStart = rows[emptyStateActionRowIndex]!.text.indexOf('[+ thread]');
  assert.equal(buttonStart >= 0, true);
  assert.equal(
    actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, buttonStart),
    'conversation.new',
  );
  const paneCols = 48;
  const alignedButtonStart = paneCols - '[+ thread]'.length;
  assert.equal(
    actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, alignedButtonStart, paneCols),
    'conversation.new',
  );
  assert.equal(
    actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, buttonStart, paneCols),
    null,
  );
  assert.equal(actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, 0), null);
});

void test('workspace rail model keeps key navigation rows when constrained to tiny heights', () => {
  const twoRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    2,
  );
  assert.equal(twoRows.length, 2);
  assert.equal(twoRows[0]?.railAction, 'project.add');
  assert.equal(twoRows[1]?.railAction, 'home.open');

  const truncated = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'dir',
          worktreeId: 'w',
          git: {
            branch: 'main',
            additions: 1,
            deletions: 2,
            changedFiles: 3,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'x',
          directoryKey: 'd',
          title: 'a',
          agentLabel: 'codex',
          cpuPercent: 1.2,
          memoryMb: 30,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:59.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z'),
    },
    3,
  );
  assert.equal(truncated.length, 3);
  assert.equal(truncated[0]?.railAction, 'project.add');
  assert.equal(truncated[1]?.railAction, 'home.open');
  assert.equal(truncated[2]?.railAction, 'nim.open');
});

void test('workspace rail model supports starting normalization custom shortcuts and row hit-testing', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          title: 'untitled',
          agentLabel: 'codex',
          cpuPercent: 0.1,
          memoryMb: 10,
          lastKnownWork: null,
          status: 'running',
          attentionReason: '   ',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:20.000Z'),
    },
    20,
  );

  assert.equal(
    rows.some((row) => row.text.includes('◔ codex - untitled')),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'conversation-body' && row.text.includes('starting')),
    true,
  );
  assert.equal(
    rows.some((row) => row.text.includes('🗑 archive thread')),
    false,
  );
  assert.equal(
    rows.some((row) => row.text.includes('add project')),
    true,
  );
  const conversationRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-a',
  );
  assert.equal(conversationRowIndex >= 0, true);
  assert.equal(actionAtWorkspaceRailRow(rows, -1), null);
  assert.equal(actionAtWorkspaceRailRow(rows, 100), null);
  assert.equal(rows[0]?.railAction, 'home.open');
  const projectAddRowIndex = rows.findIndex((row) => row.railAction === 'project.add');
  assert.equal(projectAddRowIndex >= 0, true);
  assert.equal(actionAtWorkspaceRailRow(rows, projectAddRowIndex), 'project.add');
  assert.equal(actionAtWorkspaceRailCell(rows, projectAddRowIndex, 0), 'project.add');
  assert.equal(conversationIdAtWorkspaceRailRow(rows, conversationRowIndex), 'conversation-a');
  assert.equal(projectIdAtWorkspaceRailRow(rows, conversationRowIndex), 'dir');
  assert.equal(actionAtWorkspaceRailCell(rows, rows.length - 1, 0), null);
  assert.equal(conversationIdAtWorkspaceRailRow(rows, -1), null);
  assert.equal(conversationIdAtWorkspaceRailRow(rows, 100), null);
  assert.equal(projectIdAtWorkspaceRailRow(rows, -1), null);
  assert.equal(projectIdAtWorkspaceRailRow(rows, 100), null);
  assert.equal(actionAtWorkspaceRailCell(rows, -1, 0), null);
  assert.equal(actionAtWorkspaceRailCell(rows, 100, 0), null);
  assert.equal(kindAtWorkspaceRailRow(rows, conversationRowIndex), 'conversation-title');
  assert.equal(kindAtWorkspaceRailRow(rows, -1), null);
});

void test('workspace rail model omits separator when conversation title is empty', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          directoryKey: 'dir',
          title: '   ',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-empty-title',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );

  const titleRow = rows.find(
    (row) =>
      row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-empty-title',
  );
  assert.notEqual(titleRow, undefined);
  assert.equal(titleRow?.text.includes('codex - '), false);
  assert.equal(titleRow?.text.includes('codex'), true);
});

void test('workspace rail model limits active project styling to header and git rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
      activeProjectId: 'dir-a',
      activeConversationId: null,
      projectSelectionEnabled: true,
    },
    18,
  );
  const header = rows.find((row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'));
  const meta = rows.find((row) => row.kind === 'dir-meta' && row.directoryKey === 'dir-a');
  const divider = rows.find((row) => row.kind === 'muted' && row.text === '│');
  const newThreadAction = rows.find(
    (row) => row.kind === 'dir-header' && row.text.includes('[+ thread]'),
  );
  assert.equal(header?.active, true);
  assert.equal(meta, undefined);
  assert.notEqual(divider?.active, true);
  assert.equal(newThreadAction?.active, true);
});

void test('workspace rail model does not mark project active while selection mode is disabled', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
          directoryKey: 'dir-a',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    18,
  );

  const header = rows.find((row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'));
  const meta = rows.find((row) => row.kind === 'dir-meta');
  assert.equal(header?.active, false);
  assert.equal(meta, undefined);
});

void test('workspace rail model does not mark conversation active while project selection is enabled', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
          directoryKey: 'dir-a',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    24,
  );

  const header = rows.find((row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'));
  const conversationTitle = rows.find((row) => row.kind === 'conversation-title');
  const conversationBody = rows.find((row) => row.kind === 'conversation-body');
  assert.equal(header?.active, true);
  assert.equal(conversationTitle?.active, false);
  assert.equal(conversationBody?.active, false);
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.conversationStatus === null),
    false,
  );
});

void test('workspace rail model renders home as a selectable directory-style block', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
          directoryKey: 'dir-a',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      homeSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    24,
  );

  const homeHeaderIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('🏠 home'),
  );
  assert.equal(homeHeaderIndex >= 0, true);
  assert.equal(rows[homeHeaderIndex]?.active, true);
  assert.equal(rows[homeHeaderIndex]?.railAction, 'home.open');
  assert.equal(rows[homeHeaderIndex + 1]?.kind, 'dir-header');
  assert.equal(rows[homeHeaderIndex + 1]?.text.includes('🦎 nim'), true);
  assert.equal(rows[homeHeaderIndex + 1]?.railAction, 'nim.open');
  assert.equal(rows[homeHeaderIndex + 2]?.kind, 'dir-header');
  assert.equal(rows[homeHeaderIndex + 2]?.text.includes('🗂️ tasks'), true);
  assert.equal(rows[homeHeaderIndex + 2]?.text.startsWith('├─ '), true);
  assert.equal(rows[homeHeaderIndex + 2]?.text.includes('│  └─'), false);
  assert.equal(rows[homeHeaderIndex + 2]?.railAction, 'tasks.open');
  assert.equal(rows[homeHeaderIndex + 3]?.kind, 'repository-header');
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.active),
    false,
  );

  const firstProjectHeaderIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'),
  );
  assert.equal(firstProjectHeaderIndex - homeHeaderIndex > 1, true);
});

void test('workspace rail model keeps nim conversation only in fixed rail and out of project rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
          sessionId: 'nim-thread',
          directoryKey: 'dir-a',
          title: 'nim',
          agentLabel: 'nim',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'nim-thread',
      nimSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    24,
  );

  assert.equal(
    rows.some((row) => row.kind === 'dir-header' && row.text.includes('🦎 nim')),
    true,
  );
  assert.equal(
    rows.some(
      (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'nim-thread',
    ),
    false,
  );
  assert.equal(
    rows.some(
      (row) => row.kind === 'repository-header' && row.text.includes('(1 projects, 0 active)'),
    ),
    true,
  );
});

void test('workspace rail model does not mark conversation active while tasks selection is enabled', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir-a',
          workspaceId: 'alpha',
          worktreeId: 'none',
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
          directoryKey: 'dir-a',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      homeSelectionEnabled: false,
      repositorySelectionEnabled: false,
      tasksSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    24,
  );

  const tasksRow = rows.find((row) => row.railAction === 'tasks.open');
  assert.equal(tasksRow?.active, true);
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.active),
    false,
  );
});

void test('workspace rail model treats running sessions with missing last event as starting', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          sessionId: 'conversation-working',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 1,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: 'bad-time',
          lastEventAt: null,
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:20.000Z'),
    },
    26,
  );

  assert.equal(
    rows.some((row) => row.text.includes('◔ codex - task')),
    true,
  );
});

void test('workspace rail model omits repository rows even when repository data is provided', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      repositories: [
        {
          repositoryId: 'repository-1',
          name: 'harness',
          remoteUrl: 'https://github.com/jmoyers/harness.git',
          associatedProjectCount: 2,
          commitCount: 321,
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
      nowMs: Date.parse('2026-01-01T03:00:00.000Z'),
    },
    24,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-header'),
    false,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-row'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repository.add'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repository.edit'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repository.archive'),
    false,
  );
  assert.equal(
    rows.some((row) => row.railAction === 'repositories.toggle'),
    false,
  );
});

void test('workspace rail model groups tracked projects by repository and keeps empty repositories hidden', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      repositories: [
        {
          repositoryId: 'repository-1',
          name: 'harness',
          remoteUrl: 'https://github.com/jmoyers/harness.git',
          associatedProjectCount: 1,
          commitCount: 321,
          lastCommitAt: '2026-01-01T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
        {
          repositoryId: 'repository-empty',
          name: 'unused',
          remoteUrl: 'https://github.com/jmoyers/unused.git',
          associatedProjectCount: 0,
          commitCount: 1,
          lastCommitAt: '2026-01-01T00:00:00.000Z',
          shortCommitHash: 'def5678',
        },
      ],
      directories: [
        {
          key: 'tracked-dir',
          workspaceId: 'tracked-project',
          worktreeId: 'worktree-local',
          repositoryId: 'repository-1',
          git: {
            branch: 'main',
            additions: 3,
            deletions: 1,
            changedFiles: 1,
          },
        },
        {
          key: 'untracked-dir',
          workspaceId: 'scratch',
          worktreeId: 'worktree-local',
          git: {
            branch: 'scratch',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-a',
          directoryKey: 'tracked-dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          lastKnownWork: 'working: update',
          lastKnownWorkAt: '2026-01-01T00:00:04.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:04.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    32,
  );

  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'repository-header' &&
        row.repositoryId === 'repository-1' &&
        row.text.includes('harness (1 projects, 1 active)'),
    ),
    true,
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'dir-header' &&
        row.repositoryId === 'repository-1' &&
        row.text.includes('tracked-project (main:+3,-1)'),
    ),
    true,
  );
  assert.equal(
    rows.some((row) => row.kind === 'repository-header' && row.text.includes('unused')),
    false,
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'repository-header' &&
        row.repositoryId === 'untracked' &&
        row.text.includes('untracked (1 projects, 0 active)'),
    ),
    true,
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'dir-header' &&
        row.repositoryId === 'untracked' &&
        row.text.includes('📁 scratch  [+ thread]'),
    ),
    true,
  );
});

void test('workspace rail model hides zero diff counters on tracked project headers', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      repositories: [
        {
          repositoryId: 'repository-1',
          name: 'harness',
          remoteUrl: 'https://github.com/jmoyers/harness.git',
          associatedProjectCount: 1,
          commitCount: 321,
          lastCommitAt: '2026-01-01T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      directories: [
        {
          key: 'tracked-clean-dir',
          workspaceId: 'tracked-clean',
          worktreeId: 'worktree-local',
          repositoryId: 'repository-1',
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
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    24,
  );

  const trackedHeader = rows.find(
    (row) =>
      row.kind === 'dir-header' &&
      row.repositoryId === 'repository-1' &&
      row.text.includes('tracked-clean'),
  );
  if (trackedHeader === undefined) {
    throw new Error('expected tracked project header row');
  }
  assert.equal(trackedHeader.text.includes('(main)'), true);
  assert.equal(trackedHeader.text.includes('(main:+0,-0)'), false);
  assert.equal(trackedHeader.text.includes('(main:)'), false);
});

void test('workspace rail model repository id helper returns null and starting fallback status line is covered', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          sessionId: 'conversation-working-fallback',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 4.2,
          memoryMb: 16,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-working-fallback',
      nowMs: Date.parse('2026-01-01T00:00:12.000Z'),
    },
    24,
  );
  assert.equal(
    rows.some((row) => row.kind === 'conversation-body' && row.text.includes('starting')),
    true,
  );
  assert.equal(repositoryIdAtWorkspaceRailRow(rows, 0), null);
  assert.equal(repositoryIdAtWorkspaceRailRow(rows, -1), null);
  assert.equal(repositoryIdAtWorkspaceRailRow(rows, 10_000), null);
});

void test('workspace rail model does not expose thread action for headers without inline button label', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    20,
  );
  const noProjectsHeaderRowIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('no projects'),
  );
  assert.equal(noProjectsHeaderRowIndex >= 0, true);
  assert.equal(actionAtWorkspaceRailCell(rows, noProjectsHeaderRowIndex, 7, 40), null);
});

void test('workspace rail model maps both thread rows to the same conversation id', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 0.5,
          memoryMb: 9,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:02.000Z'),
    },
    26,
  );

  const titleRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-a',
  );
  const bodyRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.equal(titleRowIndex >= 0, true);
  assert.equal(bodyRowIndex >= 0, true);
  assert.equal(conversationIdAtWorkspaceRailRow(rows, titleRowIndex), 'conversation-a');
  assert.equal(conversationIdAtWorkspaceRailRow(rows, bodyRowIndex), 'conversation-a');
  assert.equal(kindAtWorkspaceRailRow(rows, bodyRowIndex), 'conversation-body');
});

void test('workspace rail model prefers last-known-work text over cpu or attention fallback', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'codex.sse_event: response.completed',
          lastKnownWorkAt: '2026-01-01T00:00:01.000Z',
          status: 'running',
          attentionReason: 'approval',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );

  const bodyRow = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.notEqual(bodyRow, undefined);
  assert.equal(bodyRow?.text.includes('codex.sse_event: response.completed'), true);
  assert.equal(bodyRow?.text.includes('11.1% · 99MB'), false);
  assert.equal(bodyRow?.text.includes('approval'), false);
});

void test('workspace rail model keeps status detail independent from controller ownership', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'working',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
          controller: {
            controllerId: 'agent-owner',
            controllerType: 'agent',
            controllerLabel: 'openclaw',
            claimedAt: '2026-01-01T00:00:01.000Z',
          },
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );

  const bodyRow = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.notEqual(bodyRow, undefined);
  assert.equal(bodyRow?.text.includes('working'), true);

  const localRows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'working',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
          controller: {
            controllerId: 'human-local',
            controllerType: 'human',
            controllerLabel: 'human-local',
            claimedAt: '2026-01-01T00:00:01.000Z',
          },
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );

  const localBodyRow = localRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.notEqual(localBodyRow, undefined);
  assert.equal(localBodyRow?.text.includes('working'), true);

  const unlabeledRows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'working',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
          controller: {
            controllerId: 'robot-7',
            controllerType: 'automation',
            controllerLabel: '   ',
            claimedAt: '2026-01-01T00:00:01.000Z',
          },
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );
  const unlabeledBodyRow = unlabeledRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.notEqual(unlabeledBodyRow, undefined);
  assert.equal(unlabeledBodyRow?.text.includes('working'), true);

  const undefinedLabelRows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'working',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
          controller: {
            controllerId: 'agent-raw',
            controllerType: 'agent',
            controllerLabel: undefined,
            claimedAt: '2026-01-01T00:00:01.000Z',
          } as unknown as {
            controllerId: string;
            controllerType: 'agent';
            controllerLabel: string | null;
            claimedAt: string;
          },
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
    20,
  );
  const undefinedLabelBodyRow = undefinedLabelRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a',
  );
  assert.notEqual(undefinedLabelBodyRow, undefined);
  assert.equal(undefinedLabelBodyRow?.text.includes('working'), true);
});
