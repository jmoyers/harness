import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  actionAtWorkspaceRailCell,
  actionAtWorkspaceRailRow,
  buildWorkspaceRailViewRows,
  conversationIdAtWorkspaceRailRow,
  projectWorkspaceRailConversation,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
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
          lastKnownWork: null,
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
          lastKnownWork: null,
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
          label: 'bun run dev',
          cpuPercent: Number.NaN,
          memoryMb: Number.NaN,
          status: 'exited'
        }
      ],
      activeProjectId: null,
      activeConversationId: 's1',
      nowMs: Date.parse('2026-01-01T00:00:10.000Z')
    },
    32
  );

  assert.equal(rows.length, 32);
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.active), true);
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.text.includes('▲ codex - untitled task 1')),
    true
  );
  assert.equal(
    rows.some(
      (row) => row.kind === 'conversation-body' && row.text.includes('approval')
    ),
    true
  );
  assert.equal(
    rows.some((row) => row.kind === 'conversation-title' && row.text.includes('■ codex - untitled task 2')),
    true
  );
  assert.equal(rows.some((row) => row.kind === 'process-meta' && row.text.includes('exited · · · ·')), true);
  assert.equal(rows.some((row) => row.kind === 'dir-header' && row.text.includes('📁 charlie')), true);
  assert.equal(rows.some((row) => row.kind === 'dir-header' && row.text.includes('[+ thread]')), true);
  assert.equal(rows.some((row) => row.text.includes('(no conversations)')), false);
  assert.equal(rows.some((row) => row.kind === 'repository-header' && row.text.includes('untracked')), true);
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
  assert.equal(rows[rows.length - 1]?.kind, 'shortcut-body');
  assert.equal(rows[0]?.railAction, 'home.open');
  const addProjectRowIndex = rows.findIndex((row) => row.railAction === 'project.add');
  const shortcutHeaderRowIndex = rows.findIndex((row) => row.kind === 'shortcut-header');
  assert.equal(addProjectRowIndex >= 0, true);
  assert.equal(shortcutHeaderRowIndex - addProjectRowIndex >= 2, true);
});

void test('workspace rail model handles empty projects and blank workspace name', () => {
  const noDirectoryRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    40
  );
  assert.equal(noDirectoryRows.some((row) => row.text.includes('no projects')), true);
  assert.equal(noDirectoryRows[0]?.railAction, 'home.open');
  const noDirectoryAddProjectRowIndex = noDirectoryRows.findIndex(
    (row) => row.railAction === 'project.add'
  );
  const noDirectoryShortcutHeaderIndex = noDirectoryRows.findIndex(
    (row) => row.kind === 'shortcut-header'
  );
  assert.equal(noDirectoryAddProjectRowIndex >= 0, true);
  assert.equal(noDirectoryShortcutHeaderIndex - noDirectoryAddProjectRowIndex >= 2, true);

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
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null
    },
    40
  );
  assert.equal(blankNameRows.some((row) => row.text.includes('(unnamed)')), true);
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
          shortCommitHash: 'abc1234'
        }
      ],
      repositoriesCollapsed: false,
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:10.000Z')
    },
    18
  );

  assert.equal(rows.some((row) => row.kind === 'repository-header'), false);
  assert.equal(rows.some((row) => row.kind === 'repository-row'), false);
  assert.equal(rows.some((row) => row.railAction === 'repository.add'), false);
  assert.equal(rows.some((row) => row.railAction === 'home.open'), false);
  assert.equal(rows.some((row) => row.railAction === 'project.add'), true);
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
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [
        {
          key: 'proc-1',
          directoryKey: 'dir',
          label: 'vite dev',
          cpuPercent: 12.34,
          memoryMb: 42.6,
          status: 'running'
        }
      ],
      activeProjectId: null,
      activeConversationId: null
    },
    24
  );

  assert.equal(rows.some((row) => row.kind === 'process-meta' && row.text.includes('12.3% · 43MB')), true);
  assert.equal(rows.some((row) => row.kind === 'repository-header'), true);
  assert.equal(rows.some((row) => row.kind === 'repository-row'), false);
  assert.equal(rows.some((row) => row.text.includes('repositories [-]')), false);
});

void test('workspace rail model ignores repository collapse flags in rail rendering', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      repositoriesCollapsed: true,
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null
    },
    13
  );

  assert.equal(rows.some((row) => row.kind === 'repository-header'), false);
  assert.equal(rows.some((row) => row.railAction === 'repositories.toggle'), false);
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
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null
    },
    26
  );

  const emptyStateActionRowIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('[+ thread]')
  );
  assert.equal(emptyStateActionRowIndex >= 0, true);
  const buttonStart = rows[emptyStateActionRowIndex]!.text.indexOf('[+ thread]');
  assert.equal(buttonStart >= 0, true);
  assert.equal(actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, buttonStart), 'conversation.new');
  const paneCols = 48;
  const alignedButtonStart = paneCols - '[+ thread]'.length;
  assert.equal(
    actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, alignedButtonStart, paneCols),
    'conversation.new'
  );
  assert.equal(actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, buttonStart, paneCols), null);
  assert.equal(actionAtWorkspaceRailCell(rows, emptyStateActionRowIndex, 0), null);
});

void test('workspace rail model truncates content before pinned shortcuts and supports two-row limit', () => {
  const twoRows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null
    },
    2
  );
  assert.equal(twoRows.length, 2);
  assert.equal(twoRows[0]?.kind, 'shortcut-body');
  assert.equal(twoRows[1]?.kind, 'shortcut-body');
  assert.equal(twoRows[0]?.text.includes('repos'), true);
  assert.equal(twoRows[1]?.text.includes('quit mux'), true);

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
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:59.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:01:00.000Z')
    },
    3
  );
  assert.equal(truncated.length, 3);
  assert.equal(truncated[0]?.text.includes('expand all repos'), true);
  assert.equal(truncated[1]?.text.includes('collapse all repos'), true);
  assert.equal(truncated[2]?.text.includes('quit mux'), true);
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
          lastKnownWork: null,
          status: 'running',
          attentionReason: '   ',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      shortcutHint: '   ',
      nowMs: Date.parse('2026-01-01T00:00:20.000Z')
    },
    20
  );

  assert.equal(rows.some((row) => row.text.includes('◔ codex - untitled')), true);
  assert.equal(rows.some((row) => row.kind === 'conversation-body' && row.text.includes('starting')), true);
  assert.equal(rows.some((row) => row.text.includes('ctrl+j/h switch')), true);
  assert.equal(rows.some((row) => row.text.includes('x archive thread')), true);
  assert.equal(rows.some((row) => row.text.includes('🗑 archive thread')), false);
  assert.equal(rows.some((row) => row.text.includes('add project')), true);
  const shortcutHeaderRowIndex = rows.findIndex((row) => row.kind === 'shortcut-header');
  assert.equal(shortcutHeaderRowIndex >= 0, true);
  const conversationRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-a'
  );
  assert.equal(conversationRowIndex >= 0, true);
  assert.equal(actionAtWorkspaceRailRow(rows, shortcutHeaderRowIndex), 'shortcuts.toggle');
  assert.equal(actionAtWorkspaceRailRow(rows, -1), null);
  assert.equal(actionAtWorkspaceRailRow(rows, 100), null);
  assert.equal(rows[0]?.railAction, 'home.open');
  const projectAddRowIndex = rows.findIndex((row) => row.railAction === 'project.add');
  assert.equal(projectAddRowIndex >= 0, true);
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
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-empty-title',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );

  const titleRow = rows.find(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-empty-title'
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
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: null,
      projectSelectionEnabled: true
    },
    18
  );
  const header = rows.find((row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'));
  const meta = rows.find((row) => row.kind === 'dir-meta' && row.directoryKey === 'dir-a');
  const divider = rows.find((row) => row.kind === 'muted' && row.text === '│');
  const newThreadAction = rows.find(
    (row) => row.kind === 'dir-header' && row.text.includes('[+ thread]')
  );
  assert.equal(header?.active, true);
  assert.equal(meta, undefined);
  assert.equal(divider?.active, false);
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
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    18
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
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    24
  );

  const header = rows.find((row) => row.kind === 'dir-header' && row.text.includes('📁 alpha'));
  const conversationTitle = rows.find((row) => row.kind === 'conversation-title');
  const conversationBody = rows.find((row) => row.kind === 'conversation-body');
  assert.equal(header?.active, true);
  assert.equal(conversationTitle?.active, false);
  assert.equal(conversationBody?.active, false);
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.conversationStatus === null), false);
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
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: 'dir-a',
      activeConversationId: 'conversation-a',
      projectSelectionEnabled: false,
      homeSelectionEnabled: true,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    24
  );

  const homeHeaderIndex = rows.findIndex((row) => row.kind === 'dir-header' && row.text.includes('🏠 home'));
  assert.equal(homeHeaderIndex >= 0, true);
  assert.equal(rows[homeHeaderIndex]?.active, true);
  assert.equal(rows[homeHeaderIndex]?.railAction, 'home.open');
  assert.equal(rows[homeHeaderIndex + 1]?.kind, 'repository-header');
  assert.equal(rows.some((row) => row.kind === 'conversation-title' && row.active), false);

  const firstProjectHeaderIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('📁 alpha')
  );
  assert.equal(firstProjectHeaderIndex - homeHeaderIndex > 1, true);
});

void test('workspace rail model overrides default shortcut text when custom hint is set', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      shortcutHint: 'ctrl+t new  ctrl+n/p switch  ctrl+] quit'
    },
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.text.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.text.includes('close project')), false);
});

void test('workspace rail model supports newline-delimited shortcut hint rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      shortcutHint: 'ctrl+t new\nctrl+n/p switch\nctrl+c quit'
    },
    10
  );

  assert.equal(rows.some((row) => row.text.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.text.includes('ctrl+c quit')), true);
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
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: 'bad-time',
          lastEventAt: null
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:20.000Z')
    },
    26
  );

  assert.equal(rows.some((row) => row.text.includes('◔ codex - task')), true);
});

void test('workspace rail model supports collapsed shortcut descriptions with clickable toggle row', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      shortcutsCollapsed: true
    },
    10
  );

  assert.equal(rows.some((row) => row.kind === 'shortcut-header' && row.text.includes('[+]')), true);
  assert.equal(rows.some((row) => row.kind === 'shortcut-body'), false);
  const shortcutHeaderRowIndex = rows.findIndex((row) => row.kind === 'shortcut-header');
  assert.equal(actionAtWorkspaceRailRow(rows, shortcutHeaderRowIndex), 'shortcuts.toggle');
  assert.equal(rows.some((row) => row.kind === 'action' && row.text.includes('add project')), true);
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
          shortCommitHash: 'abc1234'
        }
      ],
      repositoriesCollapsed: false,
      directories: [],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T03:00:00.000Z')
    },
    24
  );
  assert.equal(rows.some((row) => row.kind === 'repository-header'), false);
  assert.equal(rows.some((row) => row.kind === 'repository-row'), false);
  assert.equal(rows.some((row) => row.railAction === 'repository.add'), false);
  assert.equal(rows.some((row) => row.railAction === 'repository.edit'), false);
  assert.equal(rows.some((row) => row.railAction === 'repository.archive'), false);
  assert.equal(rows.some((row) => row.railAction === 'repositories.toggle'), false);
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
          shortCommitHash: 'abc1234'
        },
        {
          repositoryId: 'repository-empty',
          name: 'unused',
          remoteUrl: 'https://github.com/jmoyers/unused.git',
          associatedProjectCount: 0,
          commitCount: 1,
          lastCommitAt: '2026-01-01T00:00:00.000Z',
          shortCommitHash: 'def5678'
        }
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
            changedFiles: 1
          }
        },
        {
          key: 'untracked-dir',
          workspaceId: 'scratch',
          worktreeId: 'worktree-local',
          git: {
            branch: 'scratch',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:04.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    32
  );

  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'repository-header' &&
        row.repositoryId === 'repository-1' &&
        row.text.includes('harness (1 projects, 1 active)')
    ),
    true
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'dir-header' &&
        row.repositoryId === 'repository-1' &&
        row.text.includes('tracked-project (main:+3,-1)')
    ),
    true
  );
  assert.equal(rows.some((row) => row.kind === 'repository-header' && row.text.includes('unused')), false);
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'repository-header' &&
        row.repositoryId === 'untracked' &&
        row.text.includes('untracked (1 projects, 0 active)')
    ),
    true
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'dir-header' &&
        row.repositoryId === 'untracked' &&
        row.text.includes('📁 scratch  [+ thread]')
    ),
    true
  );
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
            changedFiles: 0
          }
        }
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
          lastEventAt: '2026-01-01T00:00:10.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-working-fallback',
      nowMs: Date.parse('2026-01-01T00:00:12.000Z')
    },
    24
  );
  assert.equal(rows.some((row) => row.kind === 'conversation-body' && row.text.includes('starting')), true);
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
      activeConversationId: null
    },
    20
  );
  const noProjectsHeaderRowIndex = rows.findIndex(
    (row) => row.kind === 'dir-header' && row.text.includes('no projects')
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
          cpuPercent: 0.5,
          memoryMb: 9,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:02.000Z')
    },
    26
  );

  const titleRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-a'
  );
  const bodyRowIndex = rows.findIndex(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a'
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
          cpuPercent: 11.1,
          memoryMb: 99,
          lastKnownWork: 'codex.sse_event: response.completed',
          lastKnownWorkAt: '2026-01-01T00:00:01.000Z',
          status: 'running',
          attentionReason: 'approval',
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );

  const bodyRow = rows.find((row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a');
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
            claimedAt: '2026-01-01T00:00:01.000Z'
          }
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );

  const bodyRow = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a'
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
            claimedAt: '2026-01-01T00:00:01.000Z'
          }
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );

  const localBodyRow = localRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a'
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
            claimedAt: '2026-01-01T00:00:01.000Z'
          }
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );
  const unlabeledBodyRow = unlabeledRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a'
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
            claimedAt: '2026-01-01T00:00:01.000Z'
          } as unknown as {
            controllerId: string;
            controllerType: 'agent';
            controllerLabel: string | null;
            claimedAt: string;
          }
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    },
    20
  );
  const undefinedLabelBodyRow = undefinedLabelRows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-a'
  );
  assert.notEqual(undefinedLabelBodyRow, undefined);
  assert.equal(undefinedLabelBodyRow?.text.includes('working'), true);
});

void test('workspace rail model keeps running sessions in starting when completion text is not canonical', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-lagging-complete',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'stream response.completed',
      lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:03.000Z',
      controller: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:05.000Z')
    }
  );
  assert.equal(projection.status, 'starting');
  assert.equal(projection.glyph, '◔');
});

void test('workspace rail model keeps explicit turn completion text even with newer running events', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-stale-complete',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: 0.3,
      memoryMb: 20,
      lastKnownWork: 'turn complete (812ms)',
      lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:08.000Z',
      controller: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:09.000Z')
    }
  );
  assert.equal(projection.status, 'idle');
  assert.equal(projection.glyph, '○');
  assert.equal(projection.detailText, 'turn complete (812ms)');
});

void test('workspace rail model keeps idle projection when last event does not advance past completion telemetry', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-idle-equal-event',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: 0.3,
      memoryMb: 20,
      lastKnownWork: 'turn complete (812ms)',
      lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:10.000Z',
      controller: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:11.000Z')
    }
  );
  assert.equal(projection.status, 'idle');
  assert.equal(projection.glyph, '○');
  assert.equal(projection.detailText, 'turn complete (812ms)');
});

void test('workspace rail model keeps status-line text consistent despite selected-thread output activity', () => {
  const nowMs = Date.parse('2026-01-01T00:00:10.500Z');
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
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-selected-like',
          directoryKey: 'dir',
          title: 'selected-like',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'writing response…',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.450Z'
        },
        {
          sessionId: 'conversation-unselected-like',
          directoryKey: 'dir',
          title: 'unselected-like',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'writing response…',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-selected-like',
      nowMs
    },
    24
  );

  const selectedBody = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-selected-like'
  );
  const unselectedBody = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-unselected-like'
  );
  assert.notEqual(selectedBody, undefined);
  assert.notEqual(unselectedBody, undefined);
  assert.equal(selectedBody?.text.includes('writing response…'), true);
  assert.equal(unselectedBody?.text.includes('writing response…'), true);
});

void test('workspace rail model includes normalized status in fallback detail text when telemetry is missing', () => {
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
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-no-telemetry',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 1.2,
          memoryMb: 33,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-no-telemetry',
      nowMs: Date.parse('2026-01-01T00:00:30.000Z')
    },
    24
  );
  const bodyRow = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-no-telemetry'
  );
  assert.notEqual(bodyRow, undefined);
  assert.equal(bodyRow?.text.includes('starting'), true);
});

void test('workspace rail model infers needs-action and keeps unknown running text as starting', () => {
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
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-needs-action',
          directoryKey: 'dir',
          title: 'approval',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'needs-input: approval denied',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.000Z'
        },
        {
          sessionId: 'conversation-working',
          directoryKey: 'dir',
          title: 'streaming',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'tool request in progress',
          lastKnownWorkAt: '2026-01-01T00:00:12.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:12.000Z'
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:13.000Z')
    },
    26
  );
  const needsActionRow = rows.find(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-needs-action'
  );
  const workingRow = rows.find(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-working'
  );
  assert.notEqual(needsActionRow, undefined);
  assert.notEqual(workingRow, undefined);
  assert.equal(needsActionRow?.text.includes('▲ codex - approval'), true);
  assert.equal(workingRow?.text.includes('◔ codex - streaming'), true);
});

void test('workspace rail model infers needs-action from approval-denied summary without needs-input marker', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-approval-only',
      directoryKey: 'dir',
      title: 'approval',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'approval denied by policy',
      lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:10.000Z',
      controller: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:11.000Z')
    }
  );
  assert.equal(projection.status, 'needs-action');
  assert.equal(projection.glyph, '▲');
});

void test('workspace rail conversation projection falls back to needs-input status line label', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-needs-input-detail',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      status: 'needs-input',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:30.000Z')
    }
  );

  assert.equal(projection.status, 'needs-action');
  assert.equal(projection.detailText.includes('needs input'), true);
});

void test('workspace rail model covers status inference keyword variants', () => {
  const nowMs = Date.parse('2026-01-01T00:00:20.000Z');
  const project = (lastKnownWork: string): ReturnType<typeof projectWorkspaceRailConversation> =>
    projectWorkspaceRailConversation(
      {
        sessionId: `case-${lastKnownWork}`,
        directoryKey: 'dir',
        title: 'task',
        agentLabel: 'codex',
        cpuPercent: null,
        memoryMb: null,
        lastKnownWork,
        lastKnownWorkAt: '2026-01-01T00:00:19.000Z',
        status: 'running',
        attentionReason: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:19.000Z',
        controller: null
      },
      { nowMs }
    );

  assert.equal(project('needs input from user').status, 'needs-action');
  assert.equal(project('attention-required: approval').status, 'needs-action');
  assert.equal(project('approval denied by policy').status, 'needs-action');
  assert.equal(project('conversation started').status, 'starting');
  assert.equal(project('response complete').status, 'starting');
  assert.equal(project('working: preparing changes').status, 'working');
  assert.equal(project('thinking through solution').status, 'starting');
  assert.equal(project('tool execute').status, 'starting');
  assert.equal(project('unrecognized status text').status, 'starting');
});

void test('workspace rail model treats missing lastEventAt as current for last-known-work text', () => {
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
            changedFiles: 0
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-no-last-event',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'turn complete (1200ms)',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null
        }
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-no-last-event',
      nowMs: Date.parse('2026-01-01T00:00:10.000Z')
    },
    24
  );
  const titleRow = rows.find(
    (row) => row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-no-last-event'
  );
  const bodyRow = rows.find(
    (row) => row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-no-last-event'
  );
  assert.notEqual(titleRow, undefined);
  assert.notEqual(bodyRow, undefined);
  assert.equal(titleRow?.text.includes('○ codex - task'), true);
  assert.equal(bodyRow?.text.includes('turn complete (1200ms)'), true);
});

void test('workspace rail conversation projection exposes glyph and detail text', () => {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-1',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'writing response…',
      lastKnownWorkAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:00.000Z',
      controller: null
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:01.000Z')
    }
  );
  assert.equal(projected.status, 'starting');
  assert.equal(projected.glyph, '◔');
  assert.equal(projected.detailText, 'writing response…');
});

void test('workspace rail conversation projection keeps detail text independent from controller metadata', () => {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-1',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      status: 'completed',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:00.000Z',
      controller: {
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: 'Build Bot',
        claimedAt: '2026-01-01T00:00:00.000Z'
      }
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:01.000Z')
    }
  );
  assert.equal(projected.status, 'idle');
  assert.equal(projected.glyph, '○');
  assert.equal(projected.detailText, 'inactive');
});

void test('workspace rail conversation projection supports default option branches', () => {
  const projected = projectWorkspaceRailConversation({
    sessionId: 'conversation-default',
    directoryKey: 'dir',
    title: '',
    agentLabel: 'codex',
    cpuPercent: null,
    memoryMb: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    status: 'running',
    attentionReason: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: null,
    controller: {
      controllerId: 'human-local',
      controllerType: 'human',
      controllerLabel: 'Me',
      claimedAt: '2026-01-01T00:00:00.000Z'
    }
  });
  assert.equal(projected.status, 'starting');
  assert.equal(projected.glyph, '◔');
  assert.equal(projected.detailText, 'starting');
});
