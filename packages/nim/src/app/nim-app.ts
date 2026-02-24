import { Widget, edgeInsets } from '../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../harness-ui/src/widget/reactive.ts';
import { Composer } from '../../../harness-ui/src/widgets/composer.ts';
import type { ComposerSubmitted } from '../../../harness-ui/src/widgets/composer.ts';
import { Toast } from '../../../harness-ui/src/widgets/toast.ts';
import { PaneDivider } from '../../../harness-ui/src/widgets/pane-divider.ts';
import {
  CommandPalette,
} from '../../../harness-ui/src/widgets/command-palette.ts';
import type {
  CommandExecuted,
  CommandPaletteDismissed,
} from '../../../harness-ui/src/widgets/command-palette.ts';
import type { ClippedCellBuffer } from '../../../harness-ui/src/core/cell-buffer.ts';
import type { Binding } from '../../../harness-ui/src/widget/keybinding.ts';
import type { NimRuntime, NimModelRef, SessionHandle } from '../../../nim-core/src/contracts.ts';
import { CONTEXT_WINDOW_TOKENS, DEFAULT_RUNTIME_IDS } from '../contracts/config.ts';
import type { AgentMode, ChatMsg, UiState } from '../contracts/types.ts';
import { collectFileChanges, approxTokenCount, modeTitle } from '../state/helpers.ts';
import { NIM_COMMANDS } from './commands.ts';
import { FooterView } from '../ui/views/footer-view.ts';
import { LandingView } from '../ui/views/landing-view.ts';
import { PromptShell } from '../ui/views/prompt-shell.ts';
import { SidebarView } from '../ui/views/sidebar-view.ts';
import { ConversationView } from '../ui/views/conversation-view.ts';
import { NIM_COLORS, TH } from '../ui/theme.ts';

interface RequiredApiKeyConfig {
  readonly envVar: string;
  readonly displayName: string;
}

export interface NimAppRuntime {
  readonly runtime: NimRuntime;
  readonly model: NimModelRef;
  readonly tenantId: string;
  readonly userId: string;
  readonly requiredApiKey?: RequiredApiKeyConfig | null;
  readonly hasRequiredApiKey?: () => boolean;
  readonly configureRequiredApiKey?: (apiKey: string) => void;
  readonly saveRequiredApiKey?: (input: { readonly envVar: string; readonly value: string }) => void;
}

export class NimApp extends Widget {
  static BINDINGS: Binding[] = [
    { key: 'ctrl+p', action: 'open-palette', description: 'Command palette' },
    { key: 'tab', action: 'toggle-mode', description: 'Toggle Build/Plan mode' },
  ];

  private readonly runtime: NimRuntime;
  private readonly runtimeModel: NimModelRef;
  private readonly runtimeTenantId: string;
  private readonly runtimeUserId: string;
  private readonly requiredApiKey: RequiredApiKeyConfig | null;
  private readonly hasRequiredApiKey: () => boolean;
  private readonly configureRequiredApiKey: ((apiKey: string) => void) | null;
  private readonly saveRequiredApiKey: ((input: { readonly envVar: string; readonly value: string }) => void) | null;

  private landing: LandingView;
  private conv: ConversationView;
  private divider: ReturnType<typeof PaneDivider>;
  private sidebar: SidebarView;
  private promptShell: PromptShell;
  private composer: ReturnType<typeof Composer>;
  private footer: FooterView;
  private toast: ReturnType<typeof Toast>;
  private palette: ReturnType<typeof CommandPalette> | null = null;

  private focusManager: { focus: (widget: Widget) => void } | null = null;
  private requestRender: (() => void) | null = null;

  private mode = reactive<AgentMode>('build');
  private uiState = reactive<UiState>('landing');
  private streaming = reactive(false);
  private apiKeyEntryMode = reactive(false);
  private session: SessionHandle | null = null;
  private turnCounter = 0;

  constructor(runtime: NimAppRuntime) {
    super('nim');
    this.runtime = runtime.runtime;
    this.runtimeModel = runtime.model;
    this.runtimeTenantId = runtime.tenantId;
    this.runtimeUserId = runtime.userId;
    this.requiredApiKey = runtime.requiredApiKey ?? null;
    this.hasRequiredApiKey = runtime.hasRequiredApiKey ?? (() => true);
    this.configureRequiredApiKey = runtime.configureRequiredApiKey ?? null;
    this.saveRequiredApiKey = runtime.saveRequiredApiKey ?? null;

    this.width = '100%';
    this.height = '100%';
    this.flexDirection = 'column';

    this.landing = new LandingView();
    this.landing.flexGrow = 1;

    this.conv = new ConversationView();
    this.conv.model = this.runtimeModel;
    this.conv.flexGrow = 1;
    this.conv.visible = false;

    this.divider = PaneDivider({
      id: 'main-divider',
      orientation: 'vertical',
      fg: NIM_COLORS.borderSubtle,
      draggable: false,
    });
    this.divider.visible = false;

    this.sidebar = new SidebarView();
    this.sidebar.width = 42;
    this.sidebar.visible = false;

    this.composer = Composer({
      id: 'composer',
      placeholder: 'Ask anything...',
      modeIndicator: '[Build]',
      fg: NIM_COLORS.text,
      bg: NIM_COLORS.element,
      placeholderFg: NIM_COLORS.muted,
      height: 3,
    });

    this.promptShell = new PromptShell();
    this.promptShell.height = 5;
    this.promptShell.flexDirection = 'column';
    this.promptShell.padding = edgeInsets(1, 1, 1, 2);
    this.promptShell.visible = false;
    this.landing.add(this.composer);

    this.footer = new FooterView();
    this.footer.visible = false;

    this.toast = Toast({ id: 'toast', maxVisible: 3 });

    const mainArea = new (class extends Widget {
      render(): void {}
    })('main-area');
    mainArea.flexGrow = 1;
    mainArea.flexDirection = 'row';
    mainArea.add(this.landing, this.conv, this.divider, this.sidebar);

    this.add(mainArea, this.promptShell, this.footer, this.toast);
    this.syncModeUi();
    this.syncApiKeySetupUi();
  }

  setFocusManager(focusManager: { focus: (widget: Widget) => void }): void {
    this.focusManager = focusManager;
  }

  setRequestRender(callback: () => void): void {
    this.requestRender = callback;
  }

  private apiKeySetupRequired(): boolean {
    if (this.requiredApiKey === null) {
      return false;
    }
    return !this.hasRequiredApiKey();
  }

  private syncApiKeySetupUi(): void {
    const required = this.apiKeySetupRequired();
    this.landing.apiKeyRequired = required;
    this.landing.apiKeyEntryActive = required || this.apiKeyEntryMode;
    if (this.requiredApiKey !== null) {
      this.landing.apiKeyDisplayName = this.requiredApiKey.displayName;
      this.landing.apiKeyEnvVar = this.requiredApiKey.envVar;
    }
    if (required || this.apiKeyEntryMode) {
      const envVar = this.requiredApiKey?.envVar ?? 'ANTHROPIC_API_KEY';
      this.composer.placeholder = `Paste ${envVar} and press Enter`;
      this.composer.modeIndicator = '[Setup]';
      if (this.uiState !== 'landing') {
        this.transitionToLanding();
      }
      return;
    }
    this.composer.placeholder = 'Ask anything...';
    this.syncModeUi();
  }

  private startApiKeyEntryMode(): void {
    if (this.requiredApiKey === null) {
      this.toast.info('Current model does not require an API key');
      this.requestRender?.();
      return;
    }
    this.apiKeyEntryMode = true;
    this.syncApiKeySetupUi();
    const envVar = this.requiredApiKey.envVar;
    this.toast.info(`Enter ${envVar} and press Enter`);
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  private submitApiKey(rawValue: string): void {
    const requiredApiKey = this.requiredApiKey;
    if (requiredApiKey === null) {
      this.toast.error('No API key target configured');
      return;
    }
    const apiKey = rawValue.trim();
    if (apiKey.length === 0) {
      this.toast.error(`Paste ${requiredApiKey.envVar} before submitting`);
      return;
    }
    if (this.saveRequiredApiKey === null || this.configureRequiredApiKey === null) {
      this.toast.error('API key setup is unavailable in this runtime');
      return;
    }
    try {
      this.saveRequiredApiKey({
        envVar: requiredApiKey.envVar,
        value: apiKey,
      });
      this.configureRequiredApiKey(apiKey);
      this.apiKeyEntryMode = false;
      this.syncApiKeySetupUi();
      this.toast.info(`${requiredApiKey.displayName} saved`);
      this.requestRender?.();
    } catch (error: unknown) {
      this.toast.error(`Failed to save key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private syncModeUi(): void {
    const title = modeTitle(this.mode);
    this.composer.modeIndicator = `[${title}]`;
    this.landing.mode = this.mode;
    this.conv.mode = this.mode;
    this.promptShell.mode = this.mode;
  }

  private syncSidebarMetrics(): void {
    const tokens = approxTokenCount(this.conv.messages);
    const usage = Math.min(100, Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100));

    this.sidebar.tokens = tokens;
    this.sidebar.contextPercent = usage;
    this.sidebar.cost = Number((tokens * 0.0000025).toFixed(2));
    this.sidebar.filesChanged = collectFileChanges(this.conv.messages);
  }

  private transitionToChat(): void {
    this.uiState = 'chat';
    this.landing.visible = false;
    this.conv.visible = true;
    this.divider.visible = true;
    this.sidebar.visible = true;
    this.promptShell.visible = true;
    this.composer.left = undefined;
    this.composer.top = undefined;
    this.composer.width = '100%';
    this.composer.height = 3;
    this.promptShell.add(this.composer);
    this.footer.visible = true;
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  private transitionToLanding(): void {
    this.uiState = 'landing';
    this.landing.visible = true;
    this.conv.visible = false;
    this.divider.visible = false;
    this.sidebar.visible = false;
    this.promptShell.visible = false;
    this.footer.visible = false;
    this.landing.add(this.composer);
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  actionToggleMode(): void {
    if (this.apiKeySetupRequired() || this.apiKeyEntryMode) {
      this.toast.info('Complete API key setup first');
      this.requestRender?.();
      return;
    }
    this.mode = this.mode === 'build' ? 'plan' : 'build';
    this.syncModeUi();
    this.toast.info(`Mode: ${modeTitle(this.mode)}`);
    this.requestRender?.();
  }

  onComposerSubmitted(message: ComposerSubmitted): void {
    if (this.apiKeySetupRequired() || this.apiKeyEntryMode) {
      this.submitApiKey(message.value);
      return;
    }
    if (this.uiState === 'landing') {
      this.transitionToChat();
    }

    this.conv.messages = [...this.conv.messages, { role: 'user', text: message.value, tools: [], ts: Date.now() }];
    this.conv.scrollToBottom();
    this.syncSidebarMetrics();
    this.requestRender?.();

    void this.sendToAgent(message.value);
  }

  private async sendToAgent(input: string): Promise<void> {
    const startTime = Date.now();
    this.streaming = true;
    this.promptShell.busy = true;
    this.requestRender?.();

    try {
      if (this.session === null) {
        this.session = await this.runtime.startSession({
          tenantId: this.runtimeTenantId,
          userId: this.runtimeUserId,
          model: this.runtimeModel,
        });

        this.sidebar.sessionLabel = 'New session';
        this.sidebar.sessionStartedAt = new Date().toISOString();
      }

      this.turnCounter += 1;
      const turn = await this.runtime.sendTurn({
        sessionId: this.session.sessionId,
        input,
        idempotencyKey: `turn-${this.turnCounter}`,
      });

      const stream = this.runtime.streamUi({
        tenantId: this.runtimeTenantId,
        sessionId: this.session.sessionId,
        runId: turn.runId,
        mode: 'seamless',
      });

      const assistantMessage: ChatMsg = { role: 'nim', text: '', tools: [], ts: Date.now() };
      this.conv.messages = [...this.conv.messages, assistantMessage];
      const index = this.conv.messages.length - 1;

      for await (const event of stream) {
        const current = { ...this.conv.messages[index]! };

        if (event.type === 'assistant.text.delta') {
          current.text += event.text;
        } else if (event.type === 'assistant.text.message') {
          current.text = event.text;
        } else if (event.type === 'tool.activity') {
          if (event.phase === 'start') {
            current.tools = [...current.tools, { name: event.toolName, args: '', status: 'pending' }];
          } else if (event.phase === 'end') {
            current.tools = current.tools.map((tool) =>
              tool.name === event.toolName && tool.status === 'pending'
                ? { ...tool, status: 'done' as const }
                : tool,
            );
          } else {
            current.tools = current.tools.map((tool) =>
              tool.name === event.toolName && tool.status === 'pending'
                ? { ...tool, status: 'error' as const }
                : tool,
            );
          }
        } else if (event.type === 'system.notice') {
          current.text += `${current.text.length > 0 ? '\n' : ''}[notice] ${event.text}`;
        } else if (event.type === 'assistant.state' && event.state === 'idle') {
          current.duration = Date.now() - startTime;
          this.conv.messages = this.conv.messages.map((item, messageIndex) =>
            messageIndex === index ? current : item,
          );
          this.syncSidebarMetrics();
          this.conv.scrollToBottom();
          this.streaming = false;
          this.promptShell.busy = false;
          this.requestRender?.();
          break;
        }

        this.conv.messages = this.conv.messages.map((item, messageIndex) =>
          messageIndex === index ? current : item,
        );
        this.syncSidebarMetrics();
        this.conv.scrollToBottom();
        this.requestRender?.();
      }
    } catch (error: unknown) {
      this.conv.messages = [
        ...this.conv.messages,
        {
          role: 'nim',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          tools: [],
          ts: Date.now(),
        },
      ];
      this.syncSidebarMetrics();
      this.conv.scrollToBottom();
    } finally {
      this.streaming = false;
      this.promptShell.busy = false;
      this.requestRender?.();
    }
  }

  actionOpenPalette(): void {
    if (this.palette === null) {
      this.palette = CommandPalette({
        id: 'palette',
        actions: NIM_COMMANDS,
        width: 56,
        height: 14,
      });
      this.add(this.palette);
    }

    this.palette.positionInViewport(this.computedRect.width || 80, this.computedRect.height || 24);
    this.palette.visible = true;
    this.palette.query = '';
    this.palette.selectedIndex = 0;
    this.focusManager?.focus(this.palette);
  }

  onCommandExecuted(event: CommandExecuted): void {
    if (this.palette !== null) {
      this.palette.visible = false;
    }

    let suppressActionToast = false;
    switch (event.action.id) {
      case 'new-session': {
        this.session = null;
        this.conv.messages = [];
        this.sidebar.sessionStartedAt = null;
        this.sidebar.filesChanged = [];
        this.syncSidebarMetrics();
        this.transitionToLanding();
        this.syncApiKeySetupUi();
        break;
      }
      case 'set-api-key': {
        this.startApiKeyEntryMode();
        suppressActionToast = true;
        break;
      }
      case 'mode-build': {
        this.mode = 'build';
        this.syncApiKeySetupUi();
        break;
      }
      case 'mode-plan': {
        this.mode = 'plan';
        this.syncApiKeySetupUi();
        break;
      }
      case 'toggle-sidebar': {
        if (this.uiState === 'chat') {
          this.sidebar.visible = !this.sidebar.visible;
          this.divider.visible = this.sidebar.visible;
        }
        break;
      }
      default:
        break;
    }

    if (!suppressActionToast) {
      this.toast.info(event.action.title);
    }
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  onCommandPaletteDismissed(_event: CommandPaletteDismissed): void {
    if (this.palette !== null) {
      this.palette.visible = false;
    }
    this.focusManager?.focus(this.composer);
    this.requestRender?.();
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.bg);
    }
  }
}

export function createDefaultNimAppRuntime(
  runtime: NimRuntime,
  model: NimModelRef,
): NimAppRuntime {
  return {
    runtime,
    model,
    tenantId: DEFAULT_RUNTIME_IDS.tenantId,
    userId: DEFAULT_RUNTIME_IDS.userId,
  };
}
