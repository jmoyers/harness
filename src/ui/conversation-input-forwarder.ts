import {
  classifyPaneAt as classifyPaneAtFrame,
  parseMuxInputChunk as parseMuxInputChunkFrame,
  wheelDeltaRowsFromCode,
  type computeDualPaneLayout,
} from '../mux/dual-pane-core.ts';
import { normalizeMuxKeyboardInputForPty as normalizeMuxKeyboardInputForPtyFrame } from '../mux/input-shortcuts.ts';
import { routeInputTokensForConversation as routeInputTokensForConversationFrame } from '../mux/live-mux/input-forwarding.ts';
import type { ConversationState } from '../mux/live-mux/conversation-state.ts';
import type { InputTokenRouter } from './input-token-router.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';
type DualPaneLayout = ReturnType<typeof computeDualPaneLayout>;

interface ConversationInputForwarderOptions {
  readonly getInputRemainder: () => string;
  readonly setInputRemainder: (next: string) => void;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getLayout: () => DualPaneLayout;
  readonly inputTokenRouter: Pick<InputTokenRouter, 'routeTokens'>;
  readonly getActiveConversation: () => ConversationState | null;
  readonly markDirty: () => void;
  readonly isControlledByLocalHuman: (input: {
    readonly conversation: ConversationState;
    readonly controllerId: string;
  }) => boolean;
  readonly controllerId: string;
  readonly sendInputToSession: (sessionId: string, chunk: Buffer) => void;
  readonly noteGitActivity: (directoryId: string | null) => void;
}

interface ConversationInputForwarderDependencies {
  readonly parseMuxInputChunk?: typeof parseMuxInputChunkFrame;
  readonly routeInputTokensForConversation?: typeof routeInputTokensForConversationFrame;
  readonly classifyPaneAt?: typeof classifyPaneAtFrame;
  readonly normalizeMuxKeyboardInputForPty?: typeof normalizeMuxKeyboardInputForPtyFrame;
}

export class ConversationInputForwarder {
  private readonly parseMuxInputChunk: typeof parseMuxInputChunkFrame;
  private readonly routeInputTokensForConversation: typeof routeInputTokensForConversationFrame;
  private readonly classifyPaneAt: typeof classifyPaneAtFrame;
  private readonly normalizeMuxKeyboardInputForPty: typeof normalizeMuxKeyboardInputForPtyFrame;

  constructor(
    private readonly options: ConversationInputForwarderOptions,
    dependencies: ConversationInputForwarderDependencies = {},
  ) {
    this.parseMuxInputChunk = dependencies.parseMuxInputChunk ?? parseMuxInputChunkFrame;
    this.routeInputTokensForConversation =
      dependencies.routeInputTokensForConversation ?? routeInputTokensForConversationFrame;
    this.classifyPaneAt = dependencies.classifyPaneAt ?? classifyPaneAtFrame;
    this.normalizeMuxKeyboardInputForPty =
      dependencies.normalizeMuxKeyboardInputForPty ?? normalizeMuxKeyboardInputForPtyFrame;
  }

  handleInput(input: Buffer): void {
    const parsed = this.parseMuxInputChunk(this.options.getInputRemainder(), input);
    this.options.setInputRemainder(parsed.remainder);

    const layout = this.options.getLayout();
    const inputConversation = this.options.getActiveConversation();
    const { routedTokens } = this.options.inputTokenRouter.routeTokens({
      tokens: parsed.tokens,
      layout,
      conversation: inputConversation,
      snapshotForInput:
        inputConversation === null ? null : inputConversation.oracle.snapshotWithoutHash(),
    });

    const { mainPaneScrollRows, forwardToSession } = this.routeInputTokensForConversation({
      tokens: routedTokens,
      mainPaneMode: this.options.getMainPaneMode(),
      normalizeMuxKeyboardInputForPty: this.normalizeMuxKeyboardInputForPty,
      classifyPaneAt: (col, row) => this.classifyPaneAt(layout, col, row),
      wheelDeltaRowsFromCode,
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
