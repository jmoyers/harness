import {
  detectMuxGlobalShortcut as detectMuxGlobalShortcutFrame,
  type resolveMuxShortcutBindings,
} from '../mux/input-shortcuts.ts';
import { handleGlobalShortcut as handleGlobalShortcutFrame } from '../mux/live-mux/global-shortcut-handlers.ts';

type ResolvedMuxShortcutBindings = ReturnType<typeof resolveMuxShortcutBindings>;
type ShortcutCycleDirection = 'next' | 'previous';
type MainPaneMode = 'conversation' | 'project' | 'home';

interface GlobalShortcutInputOptions {
  readonly shortcutBindings: ResolvedMuxShortcutBindings;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  readonly toggleGatewayProfile: () => Promise<void>;
  readonly toggleGatewayStatusTimeline: () => Promise<void>;
  readonly toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getActiveConversationId: () => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
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
    return this.handleGlobalShortcut({
      shortcut,
      requestStop: this.options.requestStop,
      resolveDirectoryForAction: this.options.resolveDirectoryForAction,
      openNewThreadPrompt: this.options.openNewThreadPrompt,
      toggleCommandMenu: this.options.toggleCommandMenu,
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
