import {
  detectMuxGlobalShortcut as detectMuxGlobalShortcutFrame,
  type resolveMuxShortcutBindings,
} from '../mux/input-shortcuts.ts';
import { handleGlobalShortcut as handleGlobalShortcutFrame } from '../mux/live-mux/global-shortcut-handlers.ts';

type ResolvedMuxShortcutBindings = ReturnType<typeof resolveMuxShortcutBindings>;
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

interface GlobalShortcutInputOptions {
  readonly shortcutBindings: ResolvedMuxShortcutBindings;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly toggleDebugBar: () => void;
  readonly openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  readonly toggleGatewayProfile: () => Promise<void>;
  readonly toggleGatewayStatusTimeline: () => Promise<void>;
  readonly toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getActiveConversationId: () => string | null;
  readonly getActiveConversationAgentType?: () => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly refreshAllConversationTitles: () => Promise<void>;
  readonly interruptConversation: (sessionId: string) => Promise<void>;
  readonly takeoverConversation: (sessionId: string) => Promise<void>;
  readonly openAddDirectoryPrompt: () => void;
  readonly getActiveDirectoryId: () => string | null;
  readonly directoryExists: (directoryId: string) => boolean;
  readonly closeDirectory: (directoryId: string) => Promise<void>;
  readonly cycleLeftNavSelection: (direction: ShortcutCycleDirection) => void;
}

interface GlobalShortcutInputDependencies {
  readonly detectMuxGlobalShortcut?: typeof detectMuxGlobalShortcutFrame;
  readonly handleGlobalShortcut?: typeof handleGlobalShortcutFrame;
}

export class GlobalShortcutInput {
  private readonly detectMuxGlobalShortcut: typeof detectMuxGlobalShortcutFrame;
  private readonly handleGlobalShortcut: typeof handleGlobalShortcutFrame;

  constructor(
    private readonly options: GlobalShortcutInputOptions,
    dependencies: GlobalShortcutInputDependencies = {},
  ) {
    this.detectMuxGlobalShortcut =
      dependencies.detectMuxGlobalShortcut ?? detectMuxGlobalShortcutFrame;
    this.handleGlobalShortcut = dependencies.handleGlobalShortcut ?? handleGlobalShortcutFrame;
  }

  handleInput(input: Buffer): boolean {
    const shortcut = this.detectMuxGlobalShortcut(input, this.options.shortcutBindings);
    if (
      shortcut !== null &&
      shouldBypassCtrlOnlyShortcutInTerminalConversation(shortcut) &&
      this.options.getMainPaneMode() === 'conversation' &&
      isTerminalAgentType(
        this.options.getActiveConversationAgentType === undefined
          ? null
          : this.options.getActiveConversationAgentType(),
      ) &&
      isCtrlOnlyShortcutInput(input)
    ) {
      return false;
    }
    return this.handleGlobalShortcut({
      shortcut,
      requestStop: this.options.requestStop,
      resolveDirectoryForAction: this.options.resolveDirectoryForAction,
      openNewThreadPrompt: this.options.openNewThreadPrompt,
      toggleCommandMenu: this.options.toggleCommandMenu,
      toggleDebugBar: this.options.toggleDebugBar,
      openOrCreateCritiqueConversationInDirectory:
        this.options.openOrCreateCritiqueConversationInDirectory,
      toggleGatewayProfile: this.options.toggleGatewayProfile,
      toggleGatewayStatusTimeline: this.options.toggleGatewayStatusTimeline,
      toggleGatewayRenderTrace: this.options.toggleGatewayRenderTrace,
      resolveConversationForAction: () =>
        this.options.getMainPaneMode() === 'conversation'
          ? this.options.getActiveConversationId()
          : null,
      conversationsHas: this.options.conversationsHas,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      archiveConversation: this.options.archiveConversation,
      refreshAllConversationTitles: this.options.refreshAllConversationTitles,
      interruptConversation: this.options.interruptConversation,
      takeoverConversation: this.options.takeoverConversation,
      openAddDirectoryPrompt: this.options.openAddDirectoryPrompt,
      resolveClosableDirectoryId: () => {
        const activeDirectoryId = this.options.getActiveDirectoryId();
        if (this.options.getMainPaneMode() !== 'project' || activeDirectoryId === null) {
          return null;
        }
        return this.options.directoryExists(activeDirectoryId) ? activeDirectoryId : null;
      },
      closeDirectory: this.options.closeDirectory,
      cycleLeftNavSelection: this.options.cycleLeftNavSelection,
    });
  }
}
