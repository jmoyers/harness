import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'bun:test';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { createTaskComposerBuffer } from '../src/mux/task-composer.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { ConversationPane } from '../src/ui/panes/conversation.ts';
import { HomePane } from '../src/ui/panes/home.ts';
import { ProjectPane } from '../src/ui/panes/project.ts';
import { LeftRailPane } from '../src/ui/panes/left-rail.ts';
import type { ProjectPaneSnapshot } from '../src/mux/harness-core-ui.ts';

const HARNESS_VERSION = String(
  (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: unknown })
    .version,
);

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
      if (index < value.length && value[index] === 'm') {
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

void test('conversation pane renders rows from terminal snapshot frame', () => {
  const oracle = new TerminalSnapshotOracle(12, 3);
  oracle.ingest('hello');
  const frame = oracle.snapshotWithoutHash();
  const pane = new ConversationPane();
  const rows = pane.render(frame, {
    rightCols: 12,
    paneRows: 3,
  });
  assert.equal(rows.length, 3);
});

void test('home pane renders task-focused view from repositories and tasks', () => {
  const pane = new HomePane(undefined, undefined, () => 0, {
    showTaskPlanningUi: true,
    animateBackground: false,
  });
  const view = pane.render({
    layout: {
      rightCols: 40,
      paneRows: 8,
    },
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'Harness',
          archivedAt: null,
        },
      ],
    ]),
    tasks: new Map([
      [
        'task-1',
        {
          taskId: 'task-1',
          repositoryId: 'repo-1',
          title: 'Wire pane',
          body: 'keep behavior',
          status: 'ready',
          orderIndex: 0,
          createdAt: '2026-02-18T00:00:00.000Z',
        },
      ],
    ]),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: { kind: 'draft' },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    scrollTop: 0,
  });
  assert.equal(view.rows.length, 8);
  assert.equal(view.selectedRepositoryId, 'repo-1');
  assert.equal(
    view.rows.some((row) => row.includes('\u001b[')),
    true,
  );
  assert.equal(stripAnsi(view.rows[0] ?? '').length, 40);
  const stripped = view.rows.map((row) => stripAnsi(row));
  assert.equal((stripped[5] ?? '').includes('GSV Sleeper Service'), true);
  assert.equal((stripped[6] ?? '').includes(`- harness v${HARNESS_VERSION} -`), true);
});

void test('home pane renders startup overlay when repositories and tasks are empty', () => {
  const pane = new HomePane(undefined, undefined, () => 0);
  const view = pane.render({
    layout: {
      rightCols: 64,
      paneRows: 10,
    },
    repositories: new Map(),
    tasks: new Map(),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: { kind: 'draft' },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    scrollTop: 0,
  });
  const stripped = view.rows.map((row) => stripAnsi(row));
  assert.equal(
    stripped.some((row) => row.includes('GSV Sleeper Service')),
    true,
  );
  assert.equal(
    stripped.some((row) => row.includes(`- harness v${HARNESS_VERSION} -`)),
    true,
  );
});

void test('home pane animates background by default', () => {
  const renderedTimes: number[] = [];
  let nowValue = 0;
  const pane = new HomePane(
    undefined,
    (input) => {
      renderedTimes.push(input.timeMs);
      return input.contentRows;
    },
    () => {
      nowValue += 100;
      return nowValue;
    },
  );
  const renderInput = {
    layout: {
      rightCols: 24,
      paneRows: 4,
    },
    repositories: new Map(),
    tasks: new Map(),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: { kind: 'draft' } as const,
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    scrollTop: 0,
  };
  pane.render(renderInput);
  pane.render(renderInput);
  assert.deepEqual(renderedTimes, [200, 300]);
});

void test('home pane can hide task/repository ui while keeping centered home text', () => {
  const pane = new HomePane(undefined, undefined, () => 0, {
    showTaskPlanningUi: false,
    animateBackground: false,
  });
  const view = pane.render({
    layout: {
      rightCols: 56,
      paneRows: 10,
    },
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'Harness',
          archivedAt: null,
        },
      ],
    ]),
    tasks: new Map([
      [
        'task-1',
        {
          taskId: 'task-1',
          repositoryId: 'repo-1',
          title: 'Wire pane',
          body: 'keep behavior',
          status: 'ready',
          orderIndex: 0,
          createdAt: '2026-02-18T00:00:00.000Z',
        },
      ],
    ]),
    selectedRepositoryId: 'repo-1',
    repositoryDropdownOpen: true,
    editorTarget: { kind: 'task', taskId: 'task-1' },
    draftBuffer: createTaskComposerBuffer('draft'),
    taskBufferById: new Map(),
    notice: 'notice',
    scrollTop: 3,
  });
  const strippedRows = view.rows.map((row) => stripAnsi(row));
  assert.equal(view.selectedRepositoryId, null);
  assert.equal(
    view.actions.some((action) => action !== null),
    false,
  );
  assert.equal(
    strippedRows.some((row) => row.includes('GSV Sleeper Service')),
    true,
  );
  assert.equal((strippedRows[Math.floor(strippedRows.length / 2)] ?? '').includes('GSV'), true);
  assert.equal(
    strippedRows.some((row) => row.includes('Wire pane')),
    false,
  );
});

void test('project pane renders blank fallback and snapshot rows', () => {
  const pane = new ProjectPane();
  const layout = {
    rightCols: 18,
    paneRows: 3,
  };
  const blank = pane.render({
    layout,
    snapshot: null,
    scrollTop: 2,
  });
  assert.equal(blank.rows.length, 3);
  assert.equal(blank.scrollTop, 2);

  const snapshot: ProjectPaneSnapshot = {
    directoryId: 'dir-1',
    path: '/tmp/project',
    lines: ['project test', 'path /tmp/project'],
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  const rendered = pane.render({
    layout,
    snapshot,
    scrollTop: 0,
  });
  assert.equal(rendered.rows.length, 3);
  assert.equal(rendered.scrollTop, 0);
});

void test('left rail pane delegates row rendering through rail-layout model', () => {
  const pane = new LeftRailPane();
  const result = pane.render({
    layout: {
      leftCols: 30,
      paneRows: 5,
    },
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map(),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: null,
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: false,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: true,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set(),
    shortcutsCollapsed: false,
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    shortcutBindings: resolveMuxShortcutBindings(),
    loadingGitSummary: {
      branch: 'loading',
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
  });
  assert.equal(result.ansiRows.length, 5);
  assert.equal(result.viewRows.length > 0, true);
});
