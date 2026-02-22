import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { MainPanePointerInput } from '../../../packages/harness-ui/src/interaction/main-pane-pointer-input.ts';
import { handleHomePanePointerClick } from '../../../src/mux/live-mux/home-pane-pointer.ts';
import { handleProjectPaneActionClick } from '../../../src/mux/live-mux/project-pane-pointer.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';

void test('main-pane pointer input delegates project and home pointer handlers', () => {
  const calls: string[] = [];
  let mainPaneMode: MainPaneMode = 'project';
  const input = new MainPanePointerInput(
    {
      getMainPaneMode: () => mainPaneMode,
      getProjectPaneSnapshot: () => ({ directoryId: 'dir-a' }),
      getProjectPaneScrollTop: () => 2,
      projectPaneActionAtRow: () => 'conversation.new',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`new-thread:${directoryId}`);
      },
      queueCloseDirectory: (directoryId) => {
        calls.push(`close-directory:${directoryId}`);
      },
      actionAtCell: () => 'task.ready',
      actionAtRow: () => null,
      clearTaskEditClickState: () => {
        calls.push('clear-task-click');
      },
      clearRepositoryEditClickState: () => {
        calls.push('clear-repository-click');
      },
      clearHomePaneDragState: () => {
        calls.push('clear-home-drag');
      },
      getTaskRepositoryDropdownOpen: () => false,
      setTaskRepositoryDropdownOpen: () => {
        calls.push('set-repository-dropdown');
      },
      taskIdAtRow: () => 'task-a',
      repositoryIdAtRow: () => 'repo-a',
      selectTaskById: (taskId) => {
        calls.push(`select-task:${taskId}`);
      },
      selectRepositoryById: (repositoryId) => {
        calls.push(`select-repository:${repositoryId}`);
      },
      runTaskPaneAction: (action) => {
        calls.push(`task-action:${action}`);
      },
      nowMs: () => 200,
      homePaneEditDoubleClickWindowMs: 250,
      getTaskEditClickState: () => ({ entityId: 'task-a', atMs: 100 }),
      getRepositoryEditClickState: () => ({ entityId: 'repo-a', atMs: 100 }),
      clearTaskPaneNotice: () => {
        calls.push('clear-task-notice');
      },
      setTaskEditClickState: (next) => {
        calls.push(`set-task-click:${next?.entityId ?? 'null'}`);
      },
      setRepositoryEditClickState: (next) => {
        calls.push(`set-repository-click:${next?.entityId ?? 'null'}`);
      },
      setHomePaneDragState: (next) => {
        calls.push(`set-home-drag:${next?.itemId ?? 'null'}`);
      },
      openTaskEditPrompt: (taskId) => {
        calls.push(`open-task-edit:${taskId}`);
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        calls.push(`open-repository-edit:${repositoryId}`);
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    },
    {
      handleProjectPaneActionClick: (options) => {
        calls.push(
          `project-click:${options.clickEligible}:${options.rowIndex}:${options.projectPaneScrollTop}`,
        );
        options.openNewThreadPrompt(options.snapshot?.directoryId ?? 'none');
        options.queueCloseDirectory(options.snapshot?.directoryId ?? 'none');
        options.markDirty();
        return options.clickEligible;
      },
      handleHomePanePointerClick: (options) => {
        calls.push(
          `home-click:${options.clickEligible}:${options.pointerRow}:${options.pointerCol}:${options.nowMs}`,
        );
        options.clearTaskEditClickState();
        options.clearRepositoryEditClickState();
        options.clearHomePaneDragState();
        options.setTaskRepositoryDropdownOpen(true);
        options.selectTaskById(options.taskIdAtRow(0) ?? 'none');
        options.selectRepositoryById(options.repositoryIdAtRow(0) ?? 'none');
        options.runTaskPaneAction('task.ready');
        options.clearTaskPaneNotice();
        options.setTaskEditClickState(null);
        options.setRepositoryEditClickState(null);
        options.setHomePaneDragState(null);
        options.openTaskEditPrompt('task-a');
        options.openRepositoryPromptForEdit('repo-a');
        options.markDirty();
        return options.clickEligible;
      },
    },
  );

  const projectHandled = input.handleProjectPanePointerClick({
    target: 'right',
    code: 0,
    final: 'M',
    row: 99,
    col: 10,
    paneRows: 12,
    rightCols: 80,
    rightStartCol: 25,
  });

  mainPaneMode = 'home';
  const homeHandled = input.handleHomePanePointerClick({
    target: 'right',
    code: 0,
    final: 'M',
    row: 3,
    col: 28,
    paneRows: 12,
    rightCols: 80,
    rightStartCol: 25,
  });

  assert.equal(projectHandled, true);
  assert.equal(homeHandled, true);
  assert.deepEqual(calls, [
    'project-click:true:11:2',
    'new-thread:dir-a',
    'close-directory:dir-a',
    'mark-dirty',
    'home-click:true:3:28:200',
    'clear-task-click',
    'clear-repository-click',
    'clear-home-drag',
    'set-repository-dropdown',
    'select-task:task-a',
    'select-repository:repo-a',
    'task-action:task.ready',
    'clear-task-notice',
    'set-task-click:null',
    'set-repository-click:null',
    'set-home-drag:null',
    'open-task-edit:task-a',
    'open-repository-edit:repo-a',
    'mark-dirty',
  ]);
});

void test('main-pane pointer input default dependencies return false on ineligible pointer events', () => {
  const input = new MainPanePointerInput(
    {
      getMainPaneMode: () => 'conversation',
      getProjectPaneSnapshot: () => null,
      getProjectPaneScrollTop: () => 0,
      projectPaneActionAtRow: () => null,
      openNewThreadPrompt: () => {},
      queueCloseDirectory: () => {},
      actionAtCell: () => null,
      actionAtRow: () => null,
      clearTaskEditClickState: () => {},
      clearRepositoryEditClickState: () => {},
      clearHomePaneDragState: () => {},
      getTaskRepositoryDropdownOpen: () => false,
      setTaskRepositoryDropdownOpen: () => {},
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
      selectTaskById: () => {},
      selectRepositoryById: () => {},
      runTaskPaneAction: () => {},
      nowMs: () => 0,
      homePaneEditDoubleClickWindowMs: 250,
      getTaskEditClickState: () => null,
      getRepositoryEditClickState: () => null,
      clearTaskPaneNotice: () => {},
      setTaskEditClickState: () => {},
      setRepositoryEditClickState: () => {},
      setHomePaneDragState: () => {},
      openTaskEditPrompt: () => {},
      openRepositoryPromptForEdit: () => {},
      markDirty: () => {},
    },
    {
      handleProjectPaneActionClick,
      handleHomePanePointerClick,
    },
  );

  assert.equal(
    input.handleProjectPanePointerClick({
      target: 'left',
      code: 0,
      final: 'M',
      row: 1,
      col: 1,
      paneRows: 10,
      rightCols: 60,
      rightStartCol: 20,
    }),
    false,
  );
  assert.equal(
    input.handleHomePanePointerClick({
      target: 'left',
      code: 0,
      final: 'M',
      row: 1,
      col: 1,
      paneRows: 10,
      rightCols: 60,
      rightStartCol: 20,
    }),
    false,
  );
});
