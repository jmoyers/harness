import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  computeDualPaneLayout,
  parseMuxInputChunk,
  wheelDeltaRowsFromCode,
} from '../src/mux/dual-pane-core.ts';
import {
  selectionText,
  writeTextToClipboard,
  type PaneSelection,
  type PaneSelectionDrag,
} from '../src/mux/live-mux/selection.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { ConversationSelectionInput } from '../src/ui/conversation-selection-input.ts';
import { InputTokenRouter } from '../src/ui/input-token-router.ts';

function sgrMouse(code: number, col: number, row: number, final: 'M' | 'm'): string {
  return `\u001b[<${String(code)};${String(col)};${String(row)}${final}`;
}

function lineCellForText(
  frame: ReturnType<TerminalSnapshotOracle['snapshotWithoutHash']>,
  text: string,
): { row: number; col: number } | null {
  const rowIndex = frame.lines.findIndex((line) => line.includes(text));
  if (rowIndex < 0) {
    return null;
  }
  const colIndex = frame.lines[rowIndex]!.indexOf(text);
  return {
    row: rowIndex + 1,
    col: colIndex + 1,
  };
}

void test('selection/copy integration includes offscreen rows after drag + scrollback selection', () => {
  const oracle = new TerminalSnapshotOracle(48, 6);
  const lines = Array.from({ length: 70 }, (_, index) => {
    return `COPY-LINE-${String(index).padStart(2, '0')} abcdefghijklmnopqrstuvwxyz`;
  });
  oracle.ingest(`${lines.join('\r\n')}\r\n`);

  const layout = computeDualPaneLayout(120, 24);
  const wheelCol = layout.rightStartCol + 4;
  const wheelRow = 3;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;

  const selectionInput = new ConversationSelectionInput({
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
  });

  const router = new InputTokenRouter({
    getMainPaneMode: () => 'conversation',
    pointerRoutingInput: {
      handlePaneDividerDrag: () => false,
      handleHomePaneDragRelease: () => false,
      handleSeparatorPointerPress: () => false,
      handleMainPaneWheel: ({ code }, onConversationWheel) => {
        const delta = wheelDeltaRowsFromCode(code);
        if (delta === null) {
          return false;
        }
        onConversationWheel(delta);
        return true;
      },
      handleHomePaneDragMove: () => false,
    },
    mainPanePointerInput: {
      handleProjectPanePointerClick: () => false,
      handleHomePanePointerClick: () => false,
    },
    leftRailPointerInput: {
      handlePointerClick: () => false,
    },
    conversationSelectionInput: selectionInput,
  });

  const conversation = {
    oracle: {
      scrollViewport: (delta: number) => {
        oracle.scrollViewport(delta);
      },
      snapshotWithoutHash: () => oracle.snapshotWithoutHash(),
      selectionText: (
        anchor: PaneSelection['anchor'],
        focus: PaneSelection['focus'],
      ): string => oracle.selectionText(anchor, focus),
    },
  };

  let snapshotForInput = oracle.snapshotWithoutHash();
  const routeMouse = (code: number, col: number, row: number, final: 'M' | 'm'): void => {
    const parsed = parseMuxInputChunk('', Buffer.from(sgrMouse(code, col, row, final), 'utf8'));
    const routed = router.routeTokens({
      tokens: parsed.tokens,
      layout,
      conversation,
      snapshotForInput,
    });
    snapshotForInput = routed.snapshotForInput ?? oracle.snapshotWithoutHash();
  };

  let anchorCell: { row: number; col: number } | null = lineCellForText(snapshotForInput, 'COPY-LINE-05');
  for (let index = 0; anchorCell === null && index < 120; index += 1) {
    routeMouse(64, wheelCol, wheelRow, 'M');
    anchorCell = lineCellForText(snapshotForInput, 'COPY-LINE-05');
  }
  assert.notEqual(anchorCell, null);

  const anchorAbsoluteCol = layout.rightStartCol + anchorCell!.col - 1;
  routeMouse(0, anchorAbsoluteCol, anchorCell!.row, 'M');

  let focusCell: { row: number; col: number } | null = lineCellForText(snapshotForInput, 'COPY-LINE-40');
  for (let index = 0; focusCell === null && index < 120; index += 1) {
    routeMouse(65, wheelCol, wheelRow, 'M');
    focusCell = lineCellForText(snapshotForInput, 'COPY-LINE-40');
  }
  assert.notEqual(focusCell, null);
  assert.equal(lineCellForText(snapshotForInput, 'COPY-LINE-05'), null);

  const focusColumnWithinFrame = Math.min(snapshotForInput.cols, focusCell!.col + 12);
  const focusAbsoluteCol = layout.rightStartCol + focusColumnWithinFrame - 1;
  routeMouse(32, focusAbsoluteCol, focusCell!.row, 'M');
  routeMouse(0, focusAbsoluteCol, focusCell!.row, 'm');

  assert.notEqual(selection, null);
  const copiedText = selectionText(snapshotForInput, selection);
  assert.equal(copiedText.includes('COPY-LINE-05'), true);
  assert.equal(copiedText.includes('COPY-LINE-40'), true);

  let osc52Payload = '';
  assert.equal(
    writeTextToClipboard(copiedText, (payload) => {
      osc52Payload = payload;
      return true;
    }),
    true,
  );
  const osc52Prefix = '\u001b]52;c;';
  const osc52Suffix = '\u0007';
  assert.equal(osc52Payload.startsWith(osc52Prefix), true);
  assert.equal(osc52Payload.endsWith(osc52Suffix), true);
  const encodedPayload = osc52Payload.slice(osc52Prefix.length, -osc52Suffix.length);
  const decoded = Buffer.from(encodedPayload, 'base64').toString('utf8');
  assert.equal(decoded.includes('COPY-LINE-05'), true);
  assert.equal(decoded.includes('COPY-LINE-40'), true);
});
