type ShortcutCycleDirection = 'next' | 'previous';
type MainPaneMode = 'conversation' | 'project' | 'home';

function parseNumericPrefix(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function isCtrlOnlyShortcutInput(input: Buffer): boolean {
  if (input.length === 1) {
    const byte = input[0]!;
    return (
      (byte >= 0x01 && byte <= 0x1a) ||
      byte === 0x1c ||
      byte === 0x1d ||
      byte === 0x1e ||
      byte === 0x1f
    );
  }

  const text = input.toString('utf8');
  if (text.startsWith('\u001b[') && text.endsWith('u')) {
    const kittyMatch = text.slice(2, -1).match(/^(\d+)(?::\d+)?(?:;(\d+)(?::\d+)?)?$/u);
    if (kittyMatch !== null) {
      const modifierCode = parseNumericPrefix(kittyMatch[2] ?? '1');
      return modifierCode === 5;
    }
  }

  if (text.startsWith('\u001b[27;') && text.endsWith('~')) {
    const modifyOtherKeysMatch = text.slice(2, -1).match(/^27;(\d+);(\d+)$/u);
    if (modifyOtherKeysMatch !== null) {
      const modifierCode = parseNumericPrefix(modifyOtherKeysMatch[1]!);
      return modifierCode === 5;
    }
  }

  return false;
}

function isTerminalAgentType(agentType: string | null): boolean {
  return agentType !== null && agentType.trim().toLowerCase() === 'terminal';
}

function shouldBypassCtrlOnlyShortcutInTerminalConversation(shortcut: string | null): boolean {
  if (
    shortcut === 'mux.conversation.archive' ||
    shortcut === 'mux.conversation.delete' ||
    shortcut === 'mux.conversation.next' ||
    shortcut === 'mux.conversation.previous'
  ) {
    return false;
  }
  return true;
}

export interface GlobalShortcutState {
  readonly mainPaneMode: () => MainPaneMode;
  readonly activeConversationId: () => string | null;
  readonly activeConversationAgentType?: () => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly activeDirectoryId: () => string | null;
  readonly directoryExists: (directoryId: string) => boolean;
}

export interface GlobalShortcutActions {
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  readonly toggleGatewayProfile: () => Promise<void>;
  readonly toggleGatewayStatusTimeline: () => Promise<void>;
  readonly toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly refreshAllConversationTitles: () => Promise<void>;
  readonly interruptConversation: (sessionId: string) => Promise<void>;
  readonly takeoverConversation: (sessionId: string) => Promise<void>;
  readonly openAddDirectoryPrompt: () => void;
  readonly closeDirectory: (directoryId: string) => Promise<void>;
  readonly cycleLeftNavSelection: (direction: ShortcutCycleDirection) => void;
}

export interface GlobalShortcutHandlerInput {
  readonly shortcut: string | null;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  readonly toggleGatewayProfile: () => Promise<void>;
  readonly toggleGatewayStatusTimeline: () => Promise<void>;
  readonly toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  readonly resolveConversationForAction: () => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly refreshAllConversationTitles: () => Promise<void>;
  readonly interruptConversation: (sessionId: string) => Promise<void>;
  readonly takeoverConversation: (sessionId: string) => Promise<void>;
  readonly openAddDirectoryPrompt: () => void;
  readonly resolveClosableDirectoryId: () => string | null;
  readonly closeDirectory: (directoryId: string) => Promise<void>;
  readonly cycleLeftNavSelection: (direction: ShortcutCycleDirection) => void;
}

export interface GlobalShortcutStrategies<TShortcutBindings> {
  detectShortcut(input: Buffer, bindings: TShortcutBindings): string | null;
  handleShortcut(input: GlobalShortcutHandlerInput): boolean;
}

export class GlobalShortcutInput<TShortcutBindings> {
  constructor(
    private readonly shortcutBindings: TShortcutBindings,
    private readonly state: GlobalShortcutState,
    private readonly actions: GlobalShortcutActions,
    private readonly strategies: GlobalShortcutStrategies<TShortcutBindings>,
  ) {}

  handleInput(input: Buffer): boolean {
    const shortcut = this.strategies.detectShortcut(input, this.shortcutBindings);
    if (
      shortcut !== null &&
      shouldBypassCtrlOnlyShortcutInTerminalConversation(shortcut) &&
      this.state.mainPaneMode() === 'conversation' &&
      isTerminalAgentType(
        this.state.activeConversationAgentType === undefined
          ? null
          : this.state.activeConversationAgentType(),
      ) &&
      isCtrlOnlyShortcutInput(input)
    ) {
      return false;
    }
    return this.strategies.handleShortcut({
      shortcut,
      requestStop: this.actions.requestStop,
      resolveDirectoryForAction: this.actions.resolveDirectoryForAction,
      openNewThreadPrompt: this.actions.openNewThreadPrompt,
      toggleCommandMenu: this.actions.toggleCommandMenu,
      openOrCreateCritiqueConversationInDirectory:
        this.actions.openOrCreateCritiqueConversationInDirectory,
      toggleGatewayProfile: this.actions.toggleGatewayProfile,
      toggleGatewayStatusTimeline: this.actions.toggleGatewayStatusTimeline,
      toggleGatewayRenderTrace: this.actions.toggleGatewayRenderTrace,
      resolveConversationForAction: () =>
        this.state.mainPaneMode() === 'conversation' ? this.state.activeConversationId() : null,
      conversationsHas: this.state.conversationsHas,
      queueControlPlaneOp: this.actions.queueControlPlaneOp,
      archiveConversation: this.actions.archiveConversation,
      refreshAllConversationTitles: this.actions.refreshAllConversationTitles,
      interruptConversation: this.actions.interruptConversation,
      takeoverConversation: this.actions.takeoverConversation,
      openAddDirectoryPrompt: this.actions.openAddDirectoryPrompt,
      resolveClosableDirectoryId: () => {
        const activeDirectoryId = this.state.activeDirectoryId();
        if (this.state.mainPaneMode() !== 'project' || activeDirectoryId === null) {
          return null;
        }
        return this.state.directoryExists(activeDirectoryId) ? activeDirectoryId : null;
      },
      closeDirectory: this.actions.closeDirectory,
      cycleLeftNavSelection: this.actions.cycleLeftNavSelection,
    });
  }
}
