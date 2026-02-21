export type ThreadAgentType = 'codex' | 'claude' | 'cursor' | 'terminal' | 'critique';

type CommandMenuScope = 'all' | 'thread-start' | 'theme-select' | 'shortcuts';

export interface CommandMenuState {
  readonly scope: CommandMenuScope;
  readonly query: string;
  readonly selectedIndex: number;
}

export interface CommandMenuActionDescriptor {
  readonly id: string;
  readonly title: string;
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
  readonly detail?: string;
  readonly screenLabel?: string;
  readonly sectionLabel?: string;
  readonly bindingHint?: string;
  readonly priority?: number;
}

export interface NewThreadPromptState {
  readonly directoryId: string;
  readonly selectedAgentType: ThreadAgentType;
}

export interface TaskEditorPromptState {
  readonly mode: 'create' | 'edit';
  readonly taskId: string | null;
  readonly title: string;
  readonly body: string;
  readonly repositoryIds: readonly string[];
  readonly repositoryIndex: number;
  readonly fieldIndex: 0 | 1 | 2;
  readonly error: string | null;
}

export interface RepositoryPromptState {
  readonly mode: 'add' | 'edit';
  readonly repositoryId: string | null;
  readonly value: string;
  readonly error: string | null;
}

export interface ConversationTitleEditState {
  readonly conversationId: string;
  readonly value: string;
  readonly lastSavedValue: string;
  readonly error: string | null;
  readonly persistInFlight: boolean;
  readonly debounceTimer: NodeJS.Timeout | null;
}

export interface TaskEditorSubmitPayload {
  readonly mode: 'create' | 'edit';
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly projectId?: string | null;
  readonly title: string | null;
  readonly body: string;
  readonly commandLabel: string;
}

export interface ApiKeyPromptState {
  readonly keyName: string;
  readonly displayName: string;
  readonly value: string;
  readonly error: string | null;
  readonly hasExistingValue: boolean;
}

export interface InputRouterShortcutPorts {
  readonly isModalDismissShortcut: (input: Buffer) => boolean;
  readonly isCommandMenuToggleShortcut: (input: Buffer) => boolean;
  readonly isArchiveConversationShortcut: (input: Buffer) => boolean;
}

export interface InputRouterOverlayPorts {
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildConversationTitleModalOverlay: () => { top: number } | null;
  readonly buildCommandMenuModalOverlay: () => { top: number } | null;
  readonly buildNewThreadModalOverlay: () => { top: number } | null;
  readonly resolveNewThreadPromptAgentByRow: (
    overlayTop: number,
    row: number,
  ) => ThreadAgentType | null;
}

export interface InputRouterActionPorts {
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly createAndActivateConversationInDirectory: (
    directoryId: string,
    agentType: ThreadAgentType,
  ) => Promise<void>;
  readonly addDirectoryByPath: (path: string) => Promise<void>;
  readonly normalizeGitHubRemoteUrl: (remoteUrl: string) => string | null;
  readonly upsertRepositoryByRemoteUrl: (
    remoteUrl: string,
    existingRepositoryId?: string,
  ) => Promise<void>;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly submitTaskEditorPayload: (payload: TaskEditorSubmitPayload) => void;
  readonly resolveCommandMenuActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeCommandMenuAction: (actionId: string) => void;
  readonly persistApiKey?: (keyName: string, value: string) => void;
}

export interface InputRouterStatePorts {
  readonly markDirty: () => void;
  readonly conversations: ReadonlyMap<string, { title: string }>;
  readonly scheduleConversationTitlePersist: () => void;
  readonly getTaskEditorPrompt: () => TaskEditorPromptState | null;
  readonly setTaskEditorPrompt: (next: TaskEditorPromptState | null) => void;
  readonly getApiKeyPrompt?: () => ApiKeyPromptState | null;
  readonly setApiKeyPrompt?: (next: ApiKeyPromptState | null) => void;
  readonly getConversationTitleEdit: () => ConversationTitleEditState | null;
  readonly getCommandMenu: () => CommandMenuState | null;
  readonly setCommandMenu: (menu: CommandMenuState | null) => void;
  readonly getNewThreadPrompt: () => NewThreadPromptState | null;
  readonly setNewThreadPrompt: (prompt: NewThreadPromptState | null) => void;
  readonly getAddDirectoryPrompt: () => { value: string; error: string | null } | null;
  readonly setAddDirectoryPrompt: (
    next: {
      value: string;
      error: string | null;
    } | null,
  ) => void;
  readonly getRepositoryPrompt: () => RepositoryPromptState | null;
  readonly setRepositoryPrompt: (next: RepositoryPromptState | null) => void;
}

export interface InputRouterOptions {
  readonly shortcuts: InputRouterShortcutPorts;
  readonly overlays: InputRouterOverlayPorts;
  readonly actions: InputRouterActionPorts;
  readonly state: InputRouterStatePorts;
}

export interface HandleCommandMenuInputOptions {
  readonly input: Buffer;
  readonly menu: CommandMenuState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly isToggleShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildCommandMenuModalOverlay: () => { top: number } | null;
  readonly resolveActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeAction: (actionId: string) => void;
  readonly setMenu: (next: CommandMenuState | null) => void;
  readonly markDirty: () => void;
}

export interface HandleTaskEditorPromptInputOptions {
  readonly input: Buffer;
  readonly prompt: TaskEditorPromptState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
}

export interface HandleTaskEditorPromptInputResult {
  readonly handled: boolean;
  readonly nextPrompt?: TaskEditorPromptState | null;
  readonly markDirty: boolean;
  readonly submitPayload?: TaskEditorSubmitPayload;
}

export interface HandleApiKeyPromptInputOptions {
  readonly input: Buffer;
  readonly prompt: ApiKeyPromptState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  readonly setPrompt: (next: ApiKeyPromptState | null) => void;
  readonly markDirty: () => void;
  readonly persistApiKey: (keyName: string, value: string) => void;
}

export interface HandleConversationTitleEditInputOptions {
  readonly input: Buffer;
  readonly edit: ConversationTitleEditState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly isArchiveShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildConversationTitleModalOverlay: () => { top: number } | null;
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly markDirty: () => void;
  readonly conversations: ReadonlyMap<string, { title: string }>;
  readonly scheduleConversationTitlePersist: () => void;
}

export interface HandleNewThreadPromptInputOptions {
  readonly input: Buffer;
  readonly prompt: NewThreadPromptState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildNewThreadModalOverlay: () => { top: number } | null;
  readonly resolveNewThreadPromptAgentByRow: (
    overlayTop: number,
    row: number,
  ) => ThreadAgentType | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly createAndActivateConversationInDirectory: (
    directoryId: string,
    agentType: ThreadAgentType,
  ) => Promise<void>;
  readonly markDirty: () => void;
  readonly setPrompt: (prompt: NewThreadPromptState | null) => void;
}

export interface HandleAddDirectoryPromptInputOptions {
  readonly input: Buffer;
  readonly prompt: { value: string; error: string | null } | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  readonly setPrompt: (
    next: {
      value: string;
      error: string | null;
    } | null,
  ) => void;
  readonly markDirty: () => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly addDirectoryByPath: (path: string) => Promise<void>;
}

export interface HandleRepositoryPromptInputOptions {
  readonly input: Buffer;
  readonly prompt: RepositoryPromptState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  readonly setPrompt: (next: RepositoryPromptState | null) => void;
  readonly markDirty: () => void;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly normalizeGitHubRemoteUrl: (remoteUrl: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly upsertRepositoryByRemoteUrl: (
    remoteUrl: string,
    existingRepositoryId?: string,
  ) => Promise<void>;
}

export interface InputRouterStrategies {
  handleCommandMenuInput(options: HandleCommandMenuInputOptions): boolean;
  handleTaskEditorPromptInput(
    options: HandleTaskEditorPromptInputOptions,
  ): HandleTaskEditorPromptInputResult;
  handleApiKeyPromptInput(options: HandleApiKeyPromptInputOptions): boolean;
  handleConversationTitleEditInput(options: HandleConversationTitleEditInputOptions): boolean;
  handleNewThreadPromptInput(options: HandleNewThreadPromptInputOptions): boolean;
  handleAddDirectoryPromptInput(options: HandleAddDirectoryPromptInputOptions): boolean;
  handleRepositoryPromptInput(options: HandleRepositoryPromptInputOptions): boolean;
}

export class InputRouter {
  constructor(
    private readonly options: InputRouterOptions,
    private readonly strategies: InputRouterStrategies,
  ) {}

  handleCommandMenuInput(input: Buffer): boolean {
    return this.strategies.handleCommandMenuInput({
      input,
      menu: this.options.state.getCommandMenu(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      isToggleShortcut: this.options.shortcuts.isCommandMenuToggleShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      buildCommandMenuModalOverlay: this.options.overlays.buildCommandMenuModalOverlay,
      resolveActions: this.options.actions.resolveCommandMenuActions,
      executeAction: this.options.actions.executeCommandMenuAction,
      setMenu: this.options.state.setCommandMenu,
      markDirty: this.options.state.markDirty,
    });
  }

  handleTaskEditorPromptInput(input: Buffer): boolean {
    const handled = this.strategies.handleTaskEditorPromptInput({
      input,
      prompt: this.options.state.getTaskEditorPrompt(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
    });
    if (!handled.handled) {
      return false;
    }
    if (handled.nextPrompt !== undefined) {
      this.options.state.setTaskEditorPrompt(handled.nextPrompt);
    }
    if (handled.markDirty) {
      this.options.state.markDirty();
    }
    if (handled.submitPayload !== undefined) {
      this.options.actions.submitTaskEditorPayload(handled.submitPayload);
    }
    return true;
  }

  handleRepositoryPromptInput(input: Buffer): boolean {
    return this.strategies.handleRepositoryPromptInput({
      input,
      prompt: this.options.state.getRepositoryPrompt(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      setPrompt: this.options.state.setRepositoryPrompt,
      markDirty: this.options.state.markDirty,
      repositoriesHas: this.options.actions.repositoriesHas,
      normalizeGitHubRemoteUrl: this.options.actions.normalizeGitHubRemoteUrl,
      queueControlPlaneOp: this.options.actions.queueControlPlaneOp,
      upsertRepositoryByRemoteUrl: this.options.actions.upsertRepositoryByRemoteUrl,
    });
  }

  handleApiKeyPromptInput(input: Buffer): boolean {
    if (
      this.options.state.getApiKeyPrompt === undefined ||
      this.options.state.setApiKeyPrompt === undefined ||
      this.options.actions.persistApiKey === undefined
    ) {
      return false;
    }
    return this.strategies.handleApiKeyPromptInput({
      input,
      prompt: this.options.state.getApiKeyPrompt(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      setPrompt: this.options.state.setApiKeyPrompt,
      markDirty: this.options.state.markDirty,
      persistApiKey: this.options.actions.persistApiKey,
    });
  }

  handleNewThreadPromptInput(input: Buffer): boolean {
    return this.strategies.handleNewThreadPromptInput({
      input,
      prompt: this.options.state.getNewThreadPrompt(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      buildNewThreadModalOverlay: this.options.overlays.buildNewThreadModalOverlay,
      resolveNewThreadPromptAgentByRow: this.options.overlays.resolveNewThreadPromptAgentByRow,
      queueControlPlaneOp: this.options.actions.queueControlPlaneOp,
      createAndActivateConversationInDirectory:
        this.options.actions.createAndActivateConversationInDirectory,
      markDirty: this.options.state.markDirty,
      setPrompt: this.options.state.setNewThreadPrompt,
    });
  }

  handleConversationTitleEditInput(input: Buffer): boolean {
    return this.strategies.handleConversationTitleEditInput({
      input,
      edit: this.options.state.getConversationTitleEdit(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      isArchiveShortcut: this.options.shortcuts.isArchiveConversationShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      buildConversationTitleModalOverlay: this.options.overlays.buildConversationTitleModalOverlay,
      stopConversationTitleEdit: this.options.actions.stopConversationTitleEdit,
      queueControlPlaneOp: this.options.actions.queueControlPlaneOp,
      archiveConversation: this.options.actions.archiveConversation,
      markDirty: this.options.state.markDirty,
      conversations: this.options.state.conversations,
      scheduleConversationTitlePersist: this.options.state.scheduleConversationTitlePersist,
    });
  }

  handleAddDirectoryPromptInput(input: Buffer): boolean {
    return this.strategies.handleAddDirectoryPromptInput({
      input,
      prompt: this.options.state.getAddDirectoryPrompt(),
      isQuitShortcut: this.options.shortcuts.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.overlays.dismissOnOutsideClick,
      setPrompt: this.options.state.setAddDirectoryPrompt,
      markDirty: this.options.state.markDirty,
      queueControlPlaneOp: this.options.actions.queueControlPlaneOp,
      addDirectoryByPath: this.options.actions.addDirectoryByPath,
    });
  }

  routeModalInput(input: Buffer): boolean {
    if (this.handleCommandMenuInput(input)) {
      return true;
    }
    if (this.handleTaskEditorPromptInput(input)) {
      return true;
    }
    if (this.handleRepositoryPromptInput(input)) {
      return true;
    }
    if (this.handleApiKeyPromptInput(input)) {
      return true;
    }
    if (this.handleNewThreadPromptInput(input)) {
      return true;
    }
    if (this.handleConversationTitleEditInput(input)) {
      return true;
    }
    if (this.handleAddDirectoryPromptInput(input)) {
      return true;
    }
    return false;
  }
}
