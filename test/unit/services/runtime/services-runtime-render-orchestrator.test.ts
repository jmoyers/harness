import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeRenderOrchestrator } from '../../../../src/services/runtime-render-orchestrator.ts';

interface LayoutRecord {
  readonly id: string;
}

interface ConversationRecord {
  readonly id: string;
}

interface FrameRecord {
  readonly id: string;
}

interface SelectionRecord {
  readonly id: string;
}

interface SelectionDragRecord {
  readonly id: string;
}

void test('runtime render orchestrator short-circuits when shutting down', () => {
  const calls: string[] = [];
  const orchestrator = new RuntimeRenderOrchestrator<
    LayoutRecord,
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    SelectionDragRecord,
    readonly string[]
  >({
    isScreenDirty: () => {
      calls.push('isScreenDirty');
      return true;
    },
    clearDirty: () => {
      calls.push('clearDirty');
    },
    prepareRenderState: () => {
      calls.push('prepareRenderState');
      return null;
    },
    renderLeftRail: () => {
      calls.push('renderLeftRail');
      return {
        ansiRows: [],
        viewRows: [],
      };
    },
    setLatestRailViewRows: () => {
      calls.push('setLatestRailViewRows');
    },
    renderRightRows: () => {
      calls.push('renderRightRows');
      return [];
    },
    flushRender: () => {
      calls.push('flushRender');
    },
    activeDirectoryId: () => null,
  });

  orchestrator.render({
    shuttingDown: true,
    layout: { id: 'layout-1' },
    selection: null,
    selectionDrag: null,
  });

  assert.deepEqual(calls, []);
});

void test('runtime render orchestrator short-circuits when screen is not dirty', () => {
  const calls: string[] = [];
  const orchestrator = new RuntimeRenderOrchestrator<
    LayoutRecord,
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    SelectionDragRecord,
    readonly string[]
  >({
    isScreenDirty: () => {
      calls.push('isScreenDirty');
      return false;
    },
    clearDirty: () => {
      calls.push('clearDirty');
    },
    prepareRenderState: () => {
      calls.push('prepareRenderState');
      return null;
    },
    renderLeftRail: () => {
      calls.push('renderLeftRail');
      return {
        ansiRows: [],
        viewRows: [],
      };
    },
    setLatestRailViewRows: () => {
      calls.push('setLatestRailViewRows');
    },
    renderRightRows: () => {
      calls.push('renderRightRows');
      return [];
    },
    flushRender: () => {
      calls.push('flushRender');
    },
    activeDirectoryId: () => null,
  });

  orchestrator.render({
    shuttingDown: false,
    layout: { id: 'layout-2' },
    selection: null,
    selectionDrag: null,
  });

  assert.deepEqual(calls, ['isScreenDirty']);
});

void test('runtime render orchestrator clears dirty state when render-state prep returns null', () => {
  const calls: string[] = [];
  const orchestrator = new RuntimeRenderOrchestrator<
    LayoutRecord,
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    SelectionDragRecord,
    readonly string[]
  >({
    isScreenDirty: () => true,
    clearDirty: () => {
      calls.push('clearDirty');
    },
    prepareRenderState: () => null,
    renderLeftRail: () => {
      calls.push('renderLeftRail');
      return {
        ansiRows: [],
        viewRows: [],
      };
    },
    setLatestRailViewRows: () => {
      calls.push('setLatestRailViewRows');
    },
    renderRightRows: () => {
      calls.push('renderRightRows');
      return [];
    },
    flushRender: () => {
      calls.push('flushRender');
    },
    activeDirectoryId: () => null,
  });

  orchestrator.render({
    shuttingDown: false,
    layout: { id: 'layout-3' },
    selection: null,
    selectionDrag: null,
  });

  assert.deepEqual(calls, ['clearDirty']);
});

void test('runtime render orchestrator composes rail, right rows, and flush payload', () => {
  const calls: string[] = [];
  let rightRowsInput: unknown = null;
  let flushInput: unknown = null;
  let latestRailRows: readonly string[] = [];
  const orchestrator = new RuntimeRenderOrchestrator<
    LayoutRecord,
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    SelectionDragRecord,
    readonly string[]
  >({
    isScreenDirty: () => true,
    clearDirty: () => {
      calls.push('clearDirty');
    },
    prepareRenderState: () => ({
      projectPaneActive: true,
      homePaneActive: false,
      activeConversation: { id: 'conversation-1' },
      rightFrame: { id: 'frame-1' },
      renderSelection: { id: 'selection-1' },
      selectionRows: [4, 7],
    }),
    renderLeftRail: (layout) => {
      calls.push(`renderLeftRail:${layout.id}`);
      return {
        ansiRows: ['rail-row'],
        viewRows: ['row-a', 'row-b'],
      };
    },
    setLatestRailViewRows: (rows) => {
      latestRailRows = rows;
      calls.push(`setLatestRailViewRows:${rows.length}`);
    },
    renderRightRows: (input) => {
      rightRowsInput = input;
      calls.push('renderRightRows');
      return ['right-row'];
    },
    flushRender: (input) => {
      flushInput = input;
      calls.push('flushRender');
    },
    activeDirectoryId: () => 'dir-123',
  });

  orchestrator.render({
    shuttingDown: false,
    layout: { id: 'layout-4' },
    selection: { id: 'selection-input' },
    selectionDrag: { id: 'drag-input' },
  });

  assert.deepEqual(calls, [
    'renderLeftRail:layout-4',
    'setLatestRailViewRows:2',
    'renderRightRows',
    'flushRender',
  ]);
  assert.deepEqual(latestRailRows, ['row-a', 'row-b']);
  assert.deepEqual(rightRowsInput, {
    layout: { id: 'layout-4' },
    rightFrame: { id: 'frame-1' },
    homePaneActive: false,
    projectPaneActive: true,
    activeDirectoryId: 'dir-123',
  });
  assert.deepEqual(flushInput, {
    layout: { id: 'layout-4' },
    projectPaneActive: true,
    homePaneActive: false,
    activeConversation: { id: 'conversation-1' },
    rightFrame: { id: 'frame-1' },
    renderSelection: { id: 'selection-1' },
    selectionRows: [4, 7],
    railAnsiRows: ['rail-row'],
    rightRows: ['right-row'],
  });
});
