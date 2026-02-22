import type { TerminalSnapshotFrameCore } from '../../terminal/snapshot-oracle.ts';

type RoutedInputToken =
  | {
      kind: 'passthrough';
      text: string;
    }
  | {
      kind: 'mouse';
      event: {
        col: number;
        row: number;
        code: number;
        final: 'M' | 'm';
      };
    };

interface RouteInputTokensForConversationOptions {
  tokens: readonly RoutedInputToken[];
  mainPaneMode: 'conversation' | 'project' | 'home' | 'nim';
  normalizeMuxKeyboardInputForPty: (input: Buffer) => Buffer;
  classifyPaneAt: (col: number, row: number) => string;
  wheelDeltaRowsFromCode: (code: number) => number | null;
  hasShiftModifier: (code: number) => boolean;
  layout: {
    paneRows: number;
    rightCols: number;
    rightStartCol: number;
  };
  snapshotForInput:
    | (Pick<TerminalSnapshotFrameCore, 'activeScreen' | 'viewport'> & {
        lines?: readonly string[];
      })
    | null;
  appMouseTrackingEnabled: boolean;
  hasMetaModifier?: (code: number) => boolean;
  handleMetaClick?: (input: {
    event: {
      col: number;
      row: number;
      code: number;
      final: 'M' | 'm';
    };
    layout: {
      paneRows: number;
      rightCols: number;
      rightStartCol: number;
    };
    snapshotForInput:
      | (Pick<TerminalSnapshotFrameCore, 'activeScreen' | 'viewport'> & {
          lines?: readonly string[];
        })
      | null;
  }) => boolean;
}

interface RouteInputTokensForConversationResult {
  readonly mainPaneScrollRows: number;
  readonly forwardToSession: readonly Buffer[];
}

function encodeSgrMouseEvent(code: number, col: number, row: number, final: 'M' | 'm'): Buffer {
  return Buffer.from(`\u001b[<${String(code)};${String(col)};${String(row)}${final}`, 'utf8');
}

function isWheelMouseCode(code: number): boolean {
  return (code & 0b0100_0000) !== 0;
}

function isMotionMouseCode(code: number): boolean {
  return (code & 0b0010_0000) !== 0;
}

function isLeftButtonPress(code: number, final: 'M' | 'm'): boolean {
  if (final !== 'M') {
    return false;
  }
  if (isWheelMouseCode(code) || isMotionMouseCode(code)) {
    return false;
  }
  return (code & 0b0000_0011) === 0;
}

function hasMetaModifier(code: number): boolean {
  return (code & 0b0000_1000) !== 0;
}

function shouldPassThroughMouseToConversation(
  options: Pick<
    RouteInputTokensForConversationOptions,
    'snapshotForInput' | 'appMouseTrackingEnabled' | 'hasShiftModifier'
  >,
  code: number,
): boolean {
  if (options.snapshotForInput === null) {
    return false;
  }
  if (!options.appMouseTrackingEnabled) {
    return false;
  }
  if (options.snapshotForInput.activeScreen !== 'alternate') {
    return false;
  }
  if (!options.snapshotForInput.viewport.followOutput) {
    return false;
  }
  if (options.hasShiftModifier(code)) {
    return false;
  }
  return true;
}

export function routeInputTokensForConversation(
  options: RouteInputTokensForConversationOptions,
): RouteInputTokensForConversationResult {
  let mainPaneScrollRows = 0;
  const forwardToSession: Buffer[] = [];
  for (const token of options.tokens) {
    if (token.kind === 'passthrough') {
      if (options.mainPaneMode === 'conversation' && token.text.length > 0) {
        forwardToSession.push(
          options.normalizeMuxKeyboardInputForPty(Buffer.from(token.text, 'utf8')),
        );
      }
      continue;
    }
    if (options.classifyPaneAt(token.event.col, token.event.row) !== 'right') {
      continue;
    }
    if (options.mainPaneMode !== 'conversation') {
      continue;
    }
    if (
      options.handleMetaClick !== undefined &&
      isLeftButtonPress(token.event.code, token.event.final) &&
      (options.hasMetaModifier ?? hasMetaModifier)(token.event.code)
    ) {
      const handled = options.handleMetaClick({
        event: token.event,
        layout: options.layout,
        snapshotForInput: options.snapshotForInput,
      });
      if (handled) continue;
    }
    if (shouldPassThroughMouseToConversation(options, token.event.code)) {
      const sessionCol = Math.max(
        1,
        Math.min(options.layout.rightCols, token.event.col - options.layout.rightStartCol + 1),
      );
      const sessionRow = Math.max(1, Math.min(options.layout.paneRows, token.event.row));
      forwardToSession.push(
        encodeSgrMouseEvent(token.event.code, sessionCol, sessionRow, token.event.final),
      );
      continue;
    }
    const wheelDelta = options.wheelDeltaRowsFromCode(token.event.code);
    if (wheelDelta !== null) {
      mainPaneScrollRows += wheelDelta;
      continue;
    }
    // The mux owns mouse interactions. Forwarding raw SGR mouse sequences to shell-style
    // threads produces visible control garbage (for example on initial click-to-focus).
    continue;
  }
  return {
    mainPaneScrollRows,
    forwardToSession,
  };
}
