import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { flushRuntimeRender } from '../src/services/runtime-render-flush.ts';

interface ConversationRecord {
  readonly id: string;
}

interface FrameRecord {
  readonly id: string;
}

interface SelectionRecord {
  readonly id: string;
}

interface LayoutRecord {
  readonly id: string;
}

void test('runtime render flush composes status footer, applies modal overlay, and records flush output', () => {
  const calls: string[] = [];
  let builtStatusFooter = '';
  let builtStatusRow = '';
  let renderedSelectionOverlay = '';
  let flushedRows: readonly string[] = [];

  const options = {
    perfNowNs: (() => {
      let now = 0n;
      return () => {
        now += 10_000_000n;
        return now;
      };
    })(),
    statusFooterForConversation: (conversation: ConversationRecord) => {
      calls.push(`statusFooterFor:${conversation.id}`);
      return 'base-footer';
    },
    currentStatusNotice: () => 'notice',
    currentStatusRow: () => {
      builtStatusRow = 'status-row';
      return builtStatusRow;
    },
    onStatusLineComposed: (input: {
      activeConversation: ConversationRecord | null;
      statusFooter: string;
      statusRow: string;
      projectPaneActive: boolean;
      homePaneActive: boolean;
    }) => {
      calls.push(
        `onStatusLineComposed:${input.activeConversation?.id ?? 'none'}:${input.statusFooter}:${input.statusRow}`,
      );
    },
    buildRenderRows: (
      _layout: LayoutRecord,
      _railRows: readonly string[],
      _rightRows: readonly string[],
      statusRow: string,
      statusFooter: string,
    ) => {
      builtStatusFooter = statusFooter;
      calls.push(`buildRenderRows:${statusRow}:${statusFooter}`);
      return ['row-1', 'row-2'];
    },
    buildModalOverlay: () => ({ id: 'overlay-1' }),
    applyModalOverlay: (rows: string[], overlay: { id: string }) => {
      rows[0] = `${rows[0]}:${overlay.id}`;
      calls.push(`applyModalOverlay:${overlay.id}`);
    },
    renderSelectionOverlay: (
      _layout: LayoutRecord,
      frame: FrameRecord,
      selection: SelectionRecord | null,
    ) => {
      renderedSelectionOverlay = `${frame.id}:${selection?.id ?? 'none'}`;
      return renderedSelectionOverlay;
    },
    flush: (input: {
      layout: LayoutRecord;
      rows: readonly string[];
      rightFrame: FrameRecord | null;
      selectionRows: readonly number[];
      selectionOverlay: string;
    }) => {
      flushedRows = input.rows;
      calls.push(`flush:${input.selectionOverlay}`);
      return {
        changedRowCount: 2,
        wroteOutput: true,
        shouldShowCursor: true,
      };
    },
    onFlushOutput: (input: {
      activeConversation: ConversationRecord | null;
      rightFrame: FrameRecord | null;
      rows: readonly string[];
      flushResult: { changedRowCount: number; wroteOutput: boolean; shouldShowCursor: boolean };
      changedRowCount: number;
    }) => {
      calls.push(
        `onFlushOutput:${input.activeConversation?.id ?? 'none'}:${input.rightFrame?.id ?? 'none'}:${input.changedRowCount}`,
      );
    },
    recordRenderSample: (durationMs: number, changedRowCount: number) => {
      calls.push(`recordRenderSample:${durationMs > 0 ? '1' : '0'}:${changedRowCount}`);
    },
  };

  flushRuntimeRender(options, {
    layout: { id: 'layout-1' },
    projectPaneActive: false,
    homePaneActive: false,
    activeConversation: { id: 'conversation-1' },
    rightFrame: { id: 'frame-1' },
    renderSelection: { id: 'selection-1' },
    selectionRows: [0],
    railAnsiRows: ['rail-row'],
    rightRows: ['right-row'],
  });

  assert.equal(builtStatusRow, 'status-row');
  assert.equal(builtStatusFooter, 'base-footer  notice');
  assert.equal(renderedSelectionOverlay, 'frame-1:selection-1');
  assert.deepEqual(flushedRows, ['row-1:overlay-1', 'row-2']);
  assert.deepEqual(calls, [
    'statusFooterFor:conversation-1',
    'onStatusLineComposed:conversation-1:base-footer  notice:status-row',
    'buildRenderRows:status-row:base-footer  notice',
    'applyModalOverlay:overlay-1',
    'flush:frame-1:selection-1',
    'onFlushOutput:conversation-1:frame-1:2',
    'recordRenderSample:1:2',
  ]);
});

void test('runtime render flush skips conversation footer and flush-output hook when output is not written', () => {
  const calls: string[] = [];
  const options = {
    perfNowNs: () => 10_000_000n,
    statusFooterForConversation: (_conversation: ConversationRecord) => {
      calls.push('statusFooterForConversation');
      return 'base-footer';
    },
    currentStatusNotice: () => null,
    currentStatusRow: () => 'status-row',
    buildRenderRows: (
      _layout: LayoutRecord,
      _railRows: readonly string[],
      _rightRows: readonly string[],
      _statusRow: string,
      statusFooter: string,
    ) => {
      calls.push(`buildRenderRows:${statusFooter.length === 0 ? 'empty' : statusFooter}`);
      return ['row-only'];
    },
    buildModalOverlay: () => null,
    applyModalOverlay: (_rows: string[], _overlay: { id: string }) => {
      calls.push('applyModalOverlay');
    },
    renderSelectionOverlay: (
      _layout: LayoutRecord,
      _frame: FrameRecord,
      _selection: SelectionRecord | null,
    ) => {
      calls.push('renderSelectionOverlay');
      return 'overlay';
    },
    flush: (_input: {
      layout: LayoutRecord;
      rows: readonly string[];
      rightFrame: FrameRecord | null;
      selectionRows: readonly number[];
      selectionOverlay: string;
    }) => ({
      changedRowCount: 0,
      wroteOutput: false,
      shouldShowCursor: false,
    }),
    onFlushOutput: (_input: {
      activeConversation: ConversationRecord | null;
      rightFrame: FrameRecord | null;
      rows: readonly string[];
      flushResult: { changedRowCount: number; wroteOutput: boolean; shouldShowCursor: boolean };
      changedRowCount: number;
    }) => {
      calls.push('onFlushOutput');
    },
    recordRenderSample: (_durationMs: number, changedRowCount: number) => {
      calls.push(`recordRenderSample:${changedRowCount}`);
    },
  };

  flushRuntimeRender(options, {
    layout: { id: 'layout-2' },
    projectPaneActive: true,
    homePaneActive: false,
    activeConversation: { id: 'conversation-2' },
    rightFrame: null,
    renderSelection: null,
    selectionRows: [],
    railAnsiRows: [],
    rightRows: ['row'],
  });

  assert.deepEqual(calls, ['buildRenderRows:empty', 'recordRenderSample:0']);
});
