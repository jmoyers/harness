type MainPaneMode = 'conversation' | 'project' | 'home';

interface ConversationSnapshotViewport {
  readonly top: number;
  readonly totalRows: number;
  readonly followOutput: boolean;
}

export interface ConversationSnapshotFrame {
  readonly activeScreen: 'primary' | 'alternate';
  readonly viewport: ConversationSnapshotViewport;
  readonly lines: readonly string[];
}

interface ConversationInputOracle<TSnapshotForInput extends ConversationSnapshotFrame> {
  snapshotWithoutHash: () => TSnapshotForInput;
  isMouseTrackingEnabled: () => boolean;
  scrollViewport: (deltaRows: number) => void;
}

export interface ConversationInputState<
  TSnapshotForInput extends ConversationSnapshotFrame = ConversationSnapshotFrame,
> {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly controller: unknown | null;
  readonly oracle: ConversationInputOracle<TSnapshotForInput>;
}

interface ConversationInputLayout {
  readonly cols: number;
  readonly rows: number;
  readonly paneRows: number;
  readonly statusRow: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly separatorCol: number;
  readonly rightStartCol: number;
}

type ConversationInputToken =
  | {
      readonly kind: 'passthrough';
      readonly text: string;
    }
  | {
      readonly kind: 'mouse';
      readonly event: {
        readonly sequence: string;
        readonly code: number;
        readonly col: number;
        readonly row: number;
        readonly final: 'M' | 'm';
      };
    };

interface ParsedConversationInputChunk {
  readonly tokens: readonly ConversationInputToken[];
  readonly remainder: string;
}

interface InputTokenRouterLike<
  TConversation extends ConversationInputState<TSnapshotForInput>,
  TSnapshotForInput extends ConversationSnapshotFrame,
> {
  routeTokens(input: {
    readonly tokens: readonly ConversationInputToken[];
    readonly layout: ConversationInputLayout;
    readonly conversation: TConversation | null;
    readonly snapshotForInput: TSnapshotForInput | null;
  }): {
    readonly routedTokens: readonly ConversationInputToken[];
    readonly snapshotForInput: TSnapshotForInput | null;
  };
}

interface RouteConversationTokensOptions<TSnapshotForInput extends ConversationSnapshotFrame> {
  readonly tokens: readonly ConversationInputToken[];
  readonly mainPaneMode: MainPaneMode;
  readonly normalizeMuxKeyboardInputForPty: (input: Buffer) => Buffer;
  readonly classifyPaneAt: (col: number, row: number) => string;
  readonly wheelDeltaRowsFromCode: (code: number) => number | null;
  readonly hasShiftModifier: (code: number) => boolean;
  readonly layout: {
    readonly paneRows: number;
    readonly rightCols: number;
    readonly rightStartCol: number;
  };
  readonly snapshotForInput: TSnapshotForInput | null;
  readonly appMouseTrackingEnabled: boolean;
}

interface RouteConversationTokensResult {
  readonly mainPaneScrollRows: number;
  readonly forwardToSession: readonly Buffer[];
}

function hasShiftModifier(code: number): boolean {
  return (code & 0b0000_0100) !== 0;
}

function wheelDeltaRowsFromCode(code: number): number | null {
  if ((code & 0b0100_0000) === 0) {
    return null;
  }
  return (code & 0b0000_0001) === 0 ? -1 : 1;
}

export interface ConversationInputForwarderOptions<
  TSnapshotForInput extends ConversationSnapshotFrame = ConversationSnapshotFrame,
  TConversation extends ConversationInputState<TSnapshotForInput> =
    ConversationInputState<TSnapshotForInput>,
> {
  readonly getInputRemainder: () => string;
  readonly setInputRemainder: (next: string) => void;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getLayout: () => ConversationInputLayout;
  readonly inputTokenRouter: InputTokenRouterLike<TConversation, TSnapshotForInput>;
  readonly getActiveConversation: () => TConversation | null;
  readonly markDirty: () => void;
  isControlledByLocalHuman(input: {
    readonly conversation: TConversation;
    readonly controllerId: string;
  }): boolean;
  readonly controllerId: string;
  readonly sendInputToSession: (sessionId: string, chunk: Buffer) => void;
  readonly noteGitActivity: (directoryId: string | null) => void;
  parseMuxInputChunk(previousRemainder: string, chunk: Buffer): ParsedConversationInputChunk;
  routeInputTokensForConversation(
    options: RouteConversationTokensOptions<TSnapshotForInput>,
  ): RouteConversationTokensResult;
  classifyPaneAt(layout: ConversationInputLayout, col: number, row: number): string;
  normalizeMuxKeyboardInputForPty(input: Buffer): Buffer;
}

export class ConversationInputForwarder<
  TSnapshotForInput extends ConversationSnapshotFrame = ConversationSnapshotFrame,
  TConversation extends ConversationInputState<TSnapshotForInput> =
    ConversationInputState<TSnapshotForInput>,
> {
  constructor(
    private readonly options: ConversationInputForwarderOptions<TSnapshotForInput, TConversation>,
  ) {}

  handleInput(input: Buffer): void {
    const parsed = this.options.parseMuxInputChunk(this.options.getInputRemainder(), input);
    this.options.setInputRemainder(parsed.remainder);

    const layout = this.options.getLayout();
    const inputConversation = this.options.getActiveConversation();
    const { routedTokens, snapshotForInput } = this.options.inputTokenRouter.routeTokens({
      tokens: parsed.tokens,
      layout,
      conversation: inputConversation,
      snapshotForInput:
        inputConversation === null ? null : inputConversation.oracle.snapshotWithoutHash(),
    });

    const { mainPaneScrollRows, forwardToSession } = this.options.routeInputTokensForConversation({
      tokens: routedTokens,
      mainPaneMode: this.options.getMainPaneMode(),
      normalizeMuxKeyboardInputForPty: this.options.normalizeMuxKeyboardInputForPty,
      classifyPaneAt: (col, row) => this.options.classifyPaneAt(layout, col, row),
      wheelDeltaRowsFromCode,
      hasShiftModifier,
      layout: {
        paneRows: layout.paneRows,
        rightCols: layout.rightCols,
        rightStartCol: layout.rightStartCol,
      },
      snapshotForInput,
      appMouseTrackingEnabled:
        inputConversation === null ? false : inputConversation.oracle.isMouseTrackingEnabled(),
    });

    if (mainPaneScrollRows !== 0 && inputConversation !== null) {
      inputConversation.oracle.scrollViewport(mainPaneScrollRows);
      this.options.markDirty();
    }

    if (inputConversation === null) {
      return;
    }
    if (
      inputConversation.controller !== null &&
      !this.options.isControlledByLocalHuman({
        conversation: inputConversation,
        controllerId: this.options.controllerId,
      })
    ) {
      return;
    }

    for (const forwardChunk of forwardToSession) {
      this.options.sendInputToSession(inputConversation.sessionId, forwardChunk);
    }
    if (forwardToSession.length > 0) {
      this.options.noteGitActivity(inputConversation.directoryId);
    }
  }
}
