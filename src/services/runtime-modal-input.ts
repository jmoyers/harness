import type { WorkspaceModel } from '../domain/workspace.ts';
import type { CommandMenuActionDescriptor } from '../mux/live-mux/command-menu.ts';
import { InputRouter } from '../ui/input.ts';

type InputRouterOptions = ConstructorParameters<typeof InputRouter>[0];

interface RuntimeModalInputWorkspaceActions {
  archiveConversation(sessionId: string): Promise<void>;
  createAndActivateConversationInDirectory(directoryId: string, agentType: string): Promise<void>;
  addDirectoryByPath(rawPath: string): Promise<void>;
  upsertRepositoryByRemoteUrl(remoteUrl: string, existingRepositoryId?: string): Promise<void>;
}

interface RuntimeModalInputTaskEditorActions {
  submitTaskEditorPayload(payload: Parameters<InputRouterOptions['submitTaskEditorPayload']>[0]): void;
}

interface RuntimeModalInputOptions {
  readonly workspace: WorkspaceModel;
  readonly conversations: ReadonlyMap<string, { title: string }>;
  readonly workspaceActions: RuntimeModalInputWorkspaceActions;
  readonly taskEditorActions: RuntimeModalInputTaskEditorActions;
  readonly isModalDismissShortcut: (input: Buffer) => boolean;
  readonly isCommandMenuToggleShortcut: (input: Buffer) => boolean;
  readonly isArchiveConversationShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: InputRouterOptions['dismissOnOutsideClick'];
  readonly buildCommandMenuModalOverlay: InputRouterOptions['buildCommandMenuModalOverlay'];
  readonly buildConversationTitleModalOverlay: InputRouterOptions['buildConversationTitleModalOverlay'];
  readonly buildNewThreadModalOverlay: InputRouterOptions['buildNewThreadModalOverlay'];
  readonly resolveNewThreadPromptAgentByRow: InputRouterOptions['resolveNewThreadPromptAgentByRow'];
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly normalizeGitHubRemoteUrl: (remoteUrl: string) => string | null;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly scheduleConversationTitlePersist: () => void;
  readonly resolveCommandMenuActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeCommandMenuAction: (actionId: string) => void;
  readonly markDirty: () => void;
}

interface RuntimeModalInputDependencies {
  readonly createInputRouter?: (options: InputRouterOptions) => Pick<InputRouter, 'routeModalInput'>;
}

export class RuntimeModalInput {
  private readonly inputRouter: Pick<InputRouter, 'routeModalInput'>;

  constructor(
    options: RuntimeModalInputOptions,
    dependencies: RuntimeModalInputDependencies = {},
  ) {
    const createInputRouter =
      dependencies.createInputRouter ?? ((routerOptions: InputRouterOptions) => new InputRouter(routerOptions));
    this.inputRouter = createInputRouter({
      isModalDismissShortcut: options.isModalDismissShortcut,
      isCommandMenuToggleShortcut: options.isCommandMenuToggleShortcut,
      isArchiveConversationShortcut: options.isArchiveConversationShortcut,
      dismissOnOutsideClick: options.dismissOnOutsideClick,
      buildCommandMenuModalOverlay: options.buildCommandMenuModalOverlay,
      buildConversationTitleModalOverlay: options.buildConversationTitleModalOverlay,
      buildNewThreadModalOverlay: options.buildNewThreadModalOverlay,
      resolveNewThreadPromptAgentByRow: options.resolveNewThreadPromptAgentByRow,
      stopConversationTitleEdit: options.stopConversationTitleEdit,
      queueControlPlaneOp: options.queueControlPlaneOp,
      archiveConversation: async (sessionId) => {
        await options.workspaceActions.archiveConversation(sessionId);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        await options.workspaceActions.createAndActivateConversationInDirectory(
          directoryId,
          agentType,
        );
      },
      addDirectoryByPath: async (rawPath) => {
        await options.workspaceActions.addDirectoryByPath(rawPath);
      },
      normalizeGitHubRemoteUrl: options.normalizeGitHubRemoteUrl,
      upsertRepositoryByRemoteUrl: async (remoteUrl, existingRepositoryId) => {
        await options.workspaceActions.upsertRepositoryByRemoteUrl(remoteUrl, existingRepositoryId);
      },
      repositoriesHas: options.repositoriesHas,
      markDirty: options.markDirty,
      conversations: options.conversations,
      scheduleConversationTitlePersist: options.scheduleConversationTitlePersist,
      getCommandMenu: () => options.workspace.commandMenu,
      setCommandMenu: (menu) => {
        options.workspace.commandMenu = menu;
      },
      resolveCommandMenuActions: options.resolveCommandMenuActions,
      executeCommandMenuAction: options.executeCommandMenuAction,
      getTaskEditorPrompt: () => options.workspace.taskEditorPrompt,
      setTaskEditorPrompt: (next) => {
        options.workspace.taskEditorPrompt = next;
      },
      submitTaskEditorPayload: (payload) => {
        options.taskEditorActions.submitTaskEditorPayload(payload);
      },
      getConversationTitleEdit: () => options.workspace.conversationTitleEdit,
      getNewThreadPrompt: () => options.workspace.newThreadPrompt,
      setNewThreadPrompt: (prompt) => {
        options.workspace.newThreadPrompt = prompt;
      },
      getAddDirectoryPrompt: () => options.workspace.addDirectoryPrompt,
      setAddDirectoryPrompt: (next) => {
        options.workspace.addDirectoryPrompt = next;
      },
      getRepositoryPrompt: () => options.workspace.repositoryPrompt,
      setRepositoryPrompt: (next) => {
        options.workspace.repositoryPrompt = next;
      },
    });
  }

  routeModalInput(input: Buffer): boolean {
    return this.inputRouter.routeModalInput(input);
  }
}
