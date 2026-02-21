import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ConversationSelectionInput } from '../packages/harness-ui/src/interaction/conversation-selection-input.ts';
import {
  pointFromMouseEvent,
  reduceConversationMouseSelection,
  selectionText,
} from '../src/mux/live-mux/selection.ts';

void test('conversation selection input clears selection and routes mouse reduction', () => {
  const calls: string[] = [];
  let selection: {
    anchor: { rowAbs: number; col: number };
    focus: { rowAbs: number; col: number };
    text: string;
  } | null = {
    anchor: { rowAbs: 1, col: 1 },
    focus: { rowAbs: 1, col: 4 },
    text: 'abcd',
  };
  let selectionDrag: {
    anchor: { rowAbs: number; col: number };
    focus: { rowAbs: number; col: number };
    hasDragged: boolean;
  } | null = {
    anchor: { rowAbs: 1, col: 1 },
    focus: { rowAbs: 1, col: 2 },
    hasDragged: true,
  };
  const input = new ConversationSelectionInput(
    {
      getSelection: () => selection,
      setSelection: (next) => {
        selection = next;
        calls.push(`set-selection:${next === null ? 'null' : next.text}`);
      },
      getSelectionDrag: () => selectionDrag,
      setSelectionDrag: (next) => {
        selectionDrag = next;
        calls.push(`set-selection-drag:${next === null ? 'null' : next.hasDragged}`);
      },
      pinViewportForSelection: () => {
        calls.push('pin');
      },
      releaseViewportPinForSelection: () => {
        calls.push('release');
      },
      markDirty: () => {
        calls.push('dirty');
      },
    },
    {
      pointFromMouseEvent: (layout, frame, event) => {
        calls.push(`point:${layout.paneRows}:${event.col}:${event.row}`);
        return { rowAbs: 5, col: 6 };
      },
      reduceConversationMouseSelection: (options) => {
        calls.push(
          `reduce:${options.isMainPaneTarget}:${options.isLeftButtonPress}:${options.isSelectionDrag}:${options.isMouseRelease}:${options.isWheelMouseCode}`,
        );
        calls.push(
          `selection-text:${options.selectionTextForPane({
            anchor: { rowAbs: 1, col: 1 },
            focus: { rowAbs: 1, col: 2 },
            text: '',
          })}`,
        );
        return {
          selection: {
            anchor: { rowAbs: 2, col: 2 },
            focus: { rowAbs: 2, col: 5 },
            text: 'next',
          },
          selectionDrag: null,
          pinViewport: true,
          releaseViewportPin: true,
          markDirty: true,
          consumed: true,
        };
      },
      selectionText: (_frame, nextSelection) =>
        nextSelection === null
          ? 'text:null'
          : `text:${nextSelection.anchor.col}-${nextSelection.focus.col}`,
    },
  );

  assert.equal(input.clearSelectionOnTextToken(2), true);
  assert.equal(selection, null);
  assert.equal(selectionDrag, null);

  selection = {
    anchor: { rowAbs: 2, col: 1 },
    focus: { rowAbs: 2, col: 2 },
    text: 'xy',
  };
  selectionDrag = {
    anchor: { rowAbs: 2, col: 1 },
    focus: { rowAbs: 2, col: 2 },
    hasDragged: false,
  };

  assert.equal(
    input.handleMouseSelection({
      layout: { paneRows: 10, rightCols: 40, rightStartCol: 15 },
      frame: {
        viewport: { top: 0, totalRows: 10, followOutput: true },
      } as never,
      isMainPaneTarget: true,
      event: { col: 20, row: 3, code: 0b0010_0000, final: 'm' },
    }),
    true,
  );
  assert.equal(selection?.text, 'next');
  assert.equal(selectionDrag, null);
  assert.deepEqual(calls, [
    'set-selection:null',
    'set-selection-drag:null',
    'release',
    'dirty',
    'point:10:20:3',
    'reduce:true:false:false:true:false',
    'selection-text:text:1-2',
    'set-selection:next',
    'set-selection-drag:null',
    'pin',
    'release',
    'dirty',
  ]);
});

void test('conversation selection input default dependencies no-op when no selection or no consumption', () => {
  let selection: {
    anchor: { rowAbs: number; col: number };
    focus: { rowAbs: number; col: number };
    text: string;
  } | null = null;
  let selectionDrag: {
    anchor: { rowAbs: number; col: number };
    focus: { rowAbs: number; col: number };
    hasDragged: boolean;
  } | null = null;
  const input = new ConversationSelectionInput(
    {
      getSelection: () => selection,
      setSelection: (next) => {
        selection = next;
      },
      getSelectionDrag: () => selectionDrag,
      setSelectionDrag: (next) => {
        selectionDrag = next;
      },
      pinViewportForSelection: () => {},
      releaseViewportPinForSelection: () => {},
      markDirty: () => {},
    },
    {
      pointFromMouseEvent,
      reduceConversationMouseSelection,
      selectionText,
    },
  );

  assert.equal(input.clearSelectionOnTextToken(0), false);
  assert.equal(
    input.handleMouseSelection({
      layout: { paneRows: 4, rightCols: 20, rightStartCol: 5 },
      frame: {
        viewport: { top: 0, totalRows: 4, followOutput: true },
      } as never,
      isMainPaneTarget: false,
      event: { col: 1, row: 1, code: 0, final: 'M' },
    }),
    false,
  );
  assert.equal(selection, null);
  assert.equal(selectionDrag, null);
});
