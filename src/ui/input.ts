import {
  handleCommandMenuInput as handleCommandMenuInputFrame,
} from '../mux/live-mux/modal-command-menu-handler.ts';
import {
  handleConversationTitleEditInput as handleConversationTitleEditInputFrame,
  handleNewThreadPromptInput as handleNewThreadPromptInputFrame,
} from '../mux/live-mux/modal-conversation-handlers.ts';
import {
  handleAddDirectoryPromptInput as handleAddDirectoryPromptInputFrame,
  handleRepositoryPromptInput as handleRepositoryPromptInputFrame,
} from '../mux/live-mux/modal-prompt-handlers.ts';
import { handleTaskEditorPromptInput as handleTaskEditorPromptInputFrame } from '../mux/live-mux/modal-task-editor-handler.ts';
import type {
  ConversationTitleEditState,
  RepositoryPromptState,
  TaskEditorPromptState,
} from '../domain/workspace.ts';
import type {
  CommandMenuActionDescriptor,
  CommandMenuState,
} from '../mux/live-mux/command-menu.ts';
import type {
  createNewThreadPromptState,
  normalizeThreadAgentType,
} from '../mux/new-thread-prompt.ts';

type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;
type TaskEditorInputResult = ReturnType<typeof handleTaskEditorPromptInputFrame>;
type TaskEditorSubmitPayload = NonNullable<TaskEditorInputResult['submitPayload']>;

interface InputRouterOptions {
  readonly isModalDismissShortcut: (input: Buffer) => boolean;
  readonly isCommandMenuToggleShortcut: (input: Buffer) => boolean;
  readonly isArchiveConversationShortcut: (input: Buffer) => boolean;
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
  readonly markDirty: () => void;
  readonly conversations: ReadonlyMap<string, { title: string }>;
  readonly scheduleConversationTitlePersist: () => void;
  readonly getTaskEditorPrompt: () => TaskEditorPromptState | null;
  readonly setTaskEditorPrompt: (next: TaskEditorPromptState | null) => void;
  readonly submitTaskEditorPayload: (payload: TaskEditorSubmitPayload) => void;
  readonly getConversationTitleEdit: () => ConversationTitleEditState | null;
  readonly getCommandMenu: () => CommandMenuState | null;
  readonly setCommandMenu: (menu: CommandMenuState | null) => void;
  readonly resolveCommandMenuActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeCommandMenuAction: (actionId: string) => void;
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

interface InputRouterDependencies {
  readonly handleCommandMenuInput?: typeof handleCommandMenuInputFrame;
  readonly handleTaskEditorPromptInput?: typeof handleTaskEditorPromptInputFrame;
  readonly handleConversationTitleEditInput?: typeof handleConversationTitleEditInputFrame;
  readonly handleNewThreadPromptInput?: typeof handleNewThreadPromptInputFrame;
  readonly handleAddDirectoryPromptInput?: typeof handleAddDirectoryPromptInputFrame;
  readonly handleRepositoryPromptInput?: typeof handleRepositoryPromptInputFrame;
}

export class InputRouter {
  private readonly handleCommandMenuInputFrame: typeof handleCommandMenuInputFrame;
  private readonly handleTaskEditorPromptInputFrame: typeof handleTaskEditorPromptInputFrame;
  private readonly handleConversationTitleEditInputFrame: typeof handleConversationTitleEditInputFrame;
  private readonly handleNewThreadPromptInputFrame: typeof handleNewThreadPromptInputFrame;
  private readonly handleAddDirectoryPromptInputFrame: typeof handleAddDirectoryPromptInputFrame;
  private readonly handleRepositoryPromptInputFrame: typeof handleRepositoryPromptInputFrame;

  constructor(
    private readonly options: InputRouterOptions,
    dependencies: InputRouterDependencies = {},
  ) {
    this.handleCommandMenuInputFrame =
      dependencies.handleCommandMenuInput ?? handleCommandMenuInputFrame;
    this.handleTaskEditorPromptInputFrame =
      dependencies.handleTaskEditorPromptInput ?? handleTaskEditorPromptInputFrame;
    this.handleConversationTitleEditInputFrame =
      dependencies.handleConversationTitleEditInput ?? handleConversationTitleEditInputFrame;
    this.handleNewThreadPromptInputFrame =
      dependencies.handleNewThreadPromptInput ?? handleNewThreadPromptInputFrame;
    this.handleAddDirectoryPromptInputFrame =
      dependencies.handleAddDirectoryPromptInput ?? handleAddDirectoryPromptInputFrame;
    this.handleRepositoryPromptInputFrame =
      dependencies.handleRepositoryPromptInput ?? handleRepositoryPromptInputFrame;
  }

  handleCommandMenuInput(input: Buffer): boolean {
    return this.handleCommandMenuInputFrame({
      input,
      menu: this.options.getCommandMenu(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      isToggleShortcut: this.options.isCommandMenuToggleShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
      buildCommandMenuModalOverlay: this.options.buildCommandMenuModalOverlay,
      resolveActions: this.options.resolveCommandMenuActions,
      executeAction: this.options.executeCommandMenuAction,
      setMenu: this.options.setCommandMenu,
      markDirty: this.options.markDirty,
    });
  }

  handleTaskEditorPromptInput(input: Buffer): boolean {
    const handled = this.handleTaskEditorPromptInputFrame({
      input,
      prompt: this.options.getTaskEditorPrompt(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
    });
    if (!handled.handled) {
      return false;
    }
    if (handled.nextPrompt !== undefined) {
      this.options.setTaskEditorPrompt(handled.nextPrompt);
    }
    if (handled.markDirty) {
      this.options.markDirty();
    }
    if (handled.submitPayload !== undefined) {
      this.options.submitTaskEditorPayload(handled.submitPayload);
    }
    return true;
  }

  handleRepositoryPromptInput(input: Buffer): boolean {
    return this.handleRepositoryPromptInputFrame({
      input,
      prompt: this.options.getRepositoryPrompt(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
      setPrompt: this.options.setRepositoryPrompt,
      markDirty: this.options.markDirty,
      repositoriesHas: this.options.repositoriesHas,
      normalizeGitHubRemoteUrl: this.options.normalizeGitHubRemoteUrl,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      upsertRepositoryByRemoteUrl: this.options.upsertRepositoryByRemoteUrl,
    });
  }

  handleNewThreadPromptInput(input: Buffer): boolean {
    return this.handleNewThreadPromptInputFrame({
      input,
      prompt: this.options.getNewThreadPrompt(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
      buildNewThreadModalOverlay: this.options.buildNewThreadModalOverlay,
      resolveNewThreadPromptAgentByRow: this.options.resolveNewThreadPromptAgentByRow,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      createAndActivateConversationInDirectory:
        this.options.createAndActivateConversationInDirectory,
      markDirty: this.options.markDirty,
      setPrompt: this.options.setNewThreadPrompt,
    });
  }

  handleConversationTitleEditInput(input: Buffer): boolean {
    return this.handleConversationTitleEditInputFrame({
      input,
      edit: this.options.getConversationTitleEdit(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      isArchiveShortcut: this.options.isArchiveConversationShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
      buildConversationTitleModalOverlay: this.options.buildConversationTitleModalOverlay,
      stopConversationTitleEdit: this.options.stopConversationTitleEdit,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      archiveConversation: this.options.archiveConversation,
      markDirty: this.options.markDirty,
      conversations: this.options.conversations,
      scheduleConversationTitlePersist: this.options.scheduleConversationTitlePersist,
    });
  }

  handleAddDirectoryPromptInput(input: Buffer): boolean {
    return this.handleAddDirectoryPromptInputFrame({
      input,
      prompt: this.options.getAddDirectoryPrompt(),
      isQuitShortcut: this.options.isModalDismissShortcut,
      dismissOnOutsideClick: this.options.dismissOnOutsideClick,
      setPrompt: this.options.setAddDirectoryPrompt,
      markDirty: this.options.markDirty,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      addDirectoryByPath: this.options.addDirectoryByPath,
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
