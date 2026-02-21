import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { PointerRoutingInput } from '../packages/harness-ui/src/interaction/pointer-routing-input.ts';
import { handleHomePaneDragRelease } from '../src/mux/live-mux/home-pane-drop.ts';
import {
  handleHomePaneDragMove,
  handleMainPaneWheelInput,
  handlePaneDividerDragInput,
  handleSeparatorPointerPress,
} from '../src/mux/live-mux/pointer-routing.ts';

void test('pointer routing input delegates drag, separator, wheel, and move handlers', () => {
  const calls: string[] = [];
  let paneDividerDragActive = true;
  let homePaneDragState: {
    kind: 'task' | 'repository';
    itemId: string;
    startedRowIndex: number;
    latestRowIndex: number;
    hasDragged: boolean;
  } | null = {
    kind: 'task',
    itemId: 'task-dragged',
    startedRowIndex: 1,
    latestRowIndex: 1,
    hasDragged: true,
  };
  let mainPaneMode: 'conversation' | 'project' | 'home' = 'home';
  let conversationWheelDelta = 0;
  let projectScroll = 0;
  let homeScroll = 0;
  const input = new PointerRoutingInput(
    {
      getPaneDividerDragActive: () => paneDividerDragActive,
      setPaneDividerDragActive: (active) => {
        paneDividerDragActive = active;
        calls.push(`set-divider-drag:${active}`);
      },
      applyPaneDividerAtCol: (col) => {
        calls.push(`apply-divider:${col}`);
      },
      getHomePaneDragState: () => homePaneDragState,
      setHomePaneDragState: (next) => {
        homePaneDragState = next;
        calls.push(`set-home-drag:${next?.itemId ?? 'null'}`);
      },
      getMainPaneMode: () => mainPaneMode,
      taskIdAtRow: (index) => `task-${index}`,
      repositoryIdAtRow: (index) => `repo-${index}`,
      reorderTaskByDrop: (draggedTaskId, targetTaskId) => {
        calls.push(`reorder-task:${draggedTaskId}:${targetTaskId}`);
      },
      reorderRepositoryByDrop: (draggedRepositoryId, targetRepositoryId) => {
        calls.push(`reorder-repository:${draggedRepositoryId}:${targetRepositoryId}`);
      },
      onProjectWheel: (delta) => {
        projectScroll += delta;
        calls.push(`project-wheel:${delta}`);
      },
      onHomeWheel: (delta) => {
        homeScroll += delta;
        calls.push(`home-wheel:${delta}`);
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    },
    {
      handlePaneDividerDragInput: (options) => {
        calls.push(
          `divider:${options.paneDividerDragActive}:${options.isMouseRelease}:${options.isWheelMouseCode}:${options.mouseCol}`,
        );
        options.setPaneDividerDragActive(false);
        options.applyPaneDividerAtCol(13);
        options.markDirty();
        return true;
      },
      handleHomePaneDragRelease: (options) => {
        calls.push(
          `release:${options.isMouseRelease}:${options.mainPaneMode}:${options.target}:${options.rowIndex}`,
        );
        options.setHomePaneDragState(null);
        options.reorderTaskByDrop(
          options.homePaneDragState?.itemId ?? 'none',
          options.taskIdAtRow(3) ?? 'none',
        );
        options.reorderRepositoryByDrop(
          options.homePaneDragState?.itemId ?? 'none',
          options.repositoryIdAtRow(3) ?? 'none',
        );
        options.markDirty();
        return true;
      },
      handleSeparatorPointerPress: (options) => {
        calls.push(
          `separator:${options.target}:${options.isLeftButtonPress}:${options.hasAltModifier}:${options.mouseCol}`,
        );
        options.setPaneDividerDragActive(true);
        options.applyPaneDividerAtCol(options.mouseCol);
        return true;
      },
      handleMainPaneWheelInput: (options) => {
        calls.push(`wheel:${options.target}:${options.wheelDelta}:${options.mainPaneMode}`);
        options.onProjectWheel(1);
        options.onHomeWheel(-2);
        options.onConversationWheel(5);
        options.markDirty();
        return true;
      },
      handleHomePaneDragMove: (options) => {
        calls.push(
          `move:${options.mainPaneMode}:${options.target}:${options.isSelectionDrag}:${options.hasAltModifier}:${options.rowIndex}`,
        );
        options.setHomePaneDragState({
          kind: 'repository',
          itemId: 'repo-dragged',
          startedRowIndex: 1,
          latestRowIndex: options.rowIndex,
          hasDragged: true,
        });
        options.markDirty();
        return true;
      },
    },
  );

  assert.equal(input.handlePaneDividerDrag({ code: 0b0100_0000, final: 'm', col: 22 }), true);
  assert.equal(input.handleHomePaneDragRelease({ final: 'm', target: 'right', rowIndex: 3 }), true);
  assert.equal(
    input.handleSeparatorPointerPress({ target: 'separator', code: 0, final: 'M', col: 17 }),
    true,
  );
  assert.equal(
    input.handleMainPaneWheel({ target: 'right', code: 0b0100_0000 }, (delta) => {
      conversationWheelDelta += delta;
      calls.push(`conversation-wheel:${delta}`);
    }),
    true,
  );
  mainPaneMode = 'conversation';
  assert.equal(
    input.handleHomePaneDragMove({ target: 'right', code: 0b0010_0000, final: 'M', rowIndex: 5 }),
    true,
  );

  assert.equal(paneDividerDragActive, true);
  assert.equal(conversationWheelDelta, 5);
  assert.equal(projectScroll, 1);
  assert.equal(homeScroll, -2);
  assert.equal(homePaneDragState?.itemId, 'repo-dragged');
  assert.deepEqual(calls, [
    'divider:true:true:true:22',
    'set-divider-drag:false',
    'apply-divider:13',
    'mark-dirty',
    'release:true:home:right:3',
    'set-home-drag:null',
    'reorder-task:task-dragged:task-3',
    'reorder-repository:task-dragged:repo-3',
    'mark-dirty',
    'separator:separator:true:false:17',
    'set-divider-drag:true',
    'apply-divider:17',
    'wheel:right:-1:home',
    'project-wheel:1',
    'home-wheel:-2',
    'conversation-wheel:5',
    'mark-dirty',
    'move:conversation:right:true:false:5',
    'set-home-drag:repo-dragged',
    'mark-dirty',
  ]);
});

void test('pointer routing input default dependencies return false for ineligible events', () => {
  const input = new PointerRoutingInput(
    {
      getPaneDividerDragActive: () => false,
      setPaneDividerDragActive: () => {},
      applyPaneDividerAtCol: () => {},
      getHomePaneDragState: () => null,
      setHomePaneDragState: () => {},
      getMainPaneMode: () => 'conversation',
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
      onProjectWheel: () => {},
      onHomeWheel: () => {},
      markDirty: () => {},
    },
    {
      handlePaneDividerDragInput,
      handleHomePaneDragRelease,
      handleSeparatorPointerPress,
      handleMainPaneWheelInput,
      handleHomePaneDragMove,
    },
  );

  assert.equal(input.handlePaneDividerDrag({ code: 0, final: 'M', col: 1 }), false);
  assert.equal(
    input.handleHomePaneDragRelease({ final: 'M', target: 'right', rowIndex: 0 }),
    false,
  );
  assert.equal(
    input.handleSeparatorPointerPress({ target: 'left', code: 0, final: 'M', col: 1 }),
    false,
  );
  assert.equal(
    input.handleMainPaneWheel({ target: 'left', code: 0 }, () => {}),
    false,
  );
  assert.equal(
    input.handleHomePaneDragMove({ target: 'right', code: 0, final: 'M', rowIndex: 0 }),
    false,
  );
});
