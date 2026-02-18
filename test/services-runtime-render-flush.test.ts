import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeRenderFlush } from '../src/services/runtime-render-flush.ts';

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

  const service = new RuntimeRenderFlush<
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    LayoutRecord,
    { id: string },
    string
  >({
    perfNowNs: (() => {
      let now = 0n;
      return () => {
        now += 10_000_000n;
        return now;
      };
    })(),
    statusFooterForConversation: (conversation) => {
      calls.push(`statusFooterFor:${conversation.id}`);
      return 'base-footer';
    },
    currentStatusNotice: () => 'notice',
    currentStatusRow: () => {
      builtStatusRow = 'status-row';
      return builtStatusRow;
    },
    buildRenderRows: (_layout, _railRows, _rightRows, statusRow, statusFooter) => {
      builtStatusFooter = statusFooter;
      calls.push(`buildRenderRows:${statusRow}:${statusFooter}`);
      return ['row-1', 'row-2'];
    },
    buildModalOverlay: () => ({ id: 'overlay-1' }),
    applyModalOverlay: (rows, overlay) => {
      rows[0] = `${rows[0]}:${overlay.id}`;
      calls.push(`applyModalOverlay:${overlay.id}`);
    },
    renderSelectionOverlay: (_layout, frame, selection) => {
      renderedSelectionOverlay = `${frame.id}:${selection?.id ?? 'none'}`;
      return renderedSelectionOverlay;
    },
    flush: (input) => {
      flushedRows = input.rows;
      calls.push(`flush:${input.selectionOverlay}`);
      return {
        changedRowCount: 2,
        wroteOutput: true,
        shouldShowCursor: true,
      };
    },
    onFlushOutput: (input) => {
      calls.push(
        `onFlushOutput:${input.activeConversation?.id ?? 'none'}:${input.rightFrame?.id ?? 'none'}:${input.changedRowCount}`,
      );
    },
    recordRenderSample: (durationMs, changedRowCount) => {
      calls.push(`recordRenderSample:${durationMs > 0 ? '1' : '0'}:${changedRowCount}`);
    },
  });

  service.flushRender({
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
    'buildRenderRows:status-row:base-footer  notice',
    'applyModalOverlay:overlay-1',
    'flush:frame-1:selection-1',
    'onFlushOutput:conversation-1:frame-1:2',
    'recordRenderSample:1:2',
  ]);
});

void test('runtime render flush skips conversation footer and flush-output hook when output is not written', () => {
  const calls: string[] = [];
  const service = new RuntimeRenderFlush<
    ConversationRecord,
    FrameRecord,
    SelectionRecord,
    LayoutRecord,
    { id: string },
    string
  >({
    perfNowNs: () => 10_000_000n,
    statusFooterForConversation: () => {
      calls.push('statusFooterForConversation');
      return 'base-footer';
    },
    currentStatusNotice: () => null,
    currentStatusRow: () => 'status-row',
    buildRenderRows: (_layout, _railRows, _rightRows, _statusRow, statusFooter) => {
      calls.push(`buildRenderRows:${statusFooter.length === 0 ? 'empty' : statusFooter}`);
      return ['row-only'];
    },
    buildModalOverlay: () => null,
    applyModalOverlay: () => {
      calls.push('applyModalOverlay');
    },
    renderSelectionOverlay: () => {
      calls.push('renderSelectionOverlay');
      return 'overlay';
    },
    flush: () => ({
      changedRowCount: 0,
      wroteOutput: false,
      shouldShowCursor: false,
    }),
    onFlushOutput: () => {
      calls.push('onFlushOutput');
    },
    recordRenderSample: (_durationMs, changedRowCount) => {
      calls.push(`recordRenderSample:${changedRowCount}`);
    },
  });

  service.flushRender({
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

  assert.deepEqual(calls, [
    'buildRenderRows:empty',
    'recordRenderSample:0',
  ]);
});
