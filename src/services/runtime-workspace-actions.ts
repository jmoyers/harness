import type { TaskPaneAction } from '../mux/harness-core-ui.ts';

interface RuntimeWorkspaceConversationActions {
  activateConversation(sessionId: string): Promise<void>;
  createAndActivateConversationInDirectory(directoryId: string, agentType: string): Promise<void>;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
}

interface RuntimeWorkspaceDirectoryActions {
  archiveConversation(sessionId: string): Promise<void>;
  addDirectoryByPath(rawPath: string): Promise<void>;
  closeDirectory(directoryId: string): Promise<void>;
}

interface RuntimeWorkspaceRepositoryActions {
  openRepositoryPromptForCreate(): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  reorderRepositoryByDrop(
    draggedRepositoryId: string,
    targetRepositoryId: string,
    orderedRepositoryIds: readonly string[],
  ): void;
  upsertRepositoryByRemoteUrl(remoteUrl: string, existingRepositoryId?: string): Promise<void>;
  archiveRepositoryById(repositoryId: string): Promise<void>;
}

interface RuntimeWorkspaceControlActions {
  interruptConversation(sessionId: string): Promise<void>;
  toggleGatewayProfiler(): Promise<void>;
  toggleGatewayStatusTimeline(): Promise<void>;
  toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
}

interface RuntimeWorkspaceTaskPaneActions {
  runTaskPaneAction(action: TaskPaneAction): void;
  openTaskEditPrompt(taskId: string): void;
  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void;
}

interface RuntimeWorkspaceTaskPaneShortcuts {
  handleInput(input: Buffer): boolean;
}

interface RuntimeWorkspaceActionsOptions {
  readonly conversationActions: RuntimeWorkspaceConversationActions;
  readonly directoryActions: RuntimeWorkspaceDirectoryActions;
  readonly repositoryActions: RuntimeWorkspaceRepositoryActions;
  readonly controlActions: RuntimeWorkspaceControlActions;
  readonly taskPaneActions: RuntimeWorkspaceTaskPaneActions;
  readonly taskPaneShortcuts: RuntimeWorkspaceTaskPaneShortcuts;
  readonly orderedActiveRepositoryIds: () => readonly string[];
}

export class RuntimeWorkspaceActions {
  constructor(private readonly options: RuntimeWorkspaceActionsOptions) {}

  async activateConversation(sessionId: string): Promise<void> {
    await this.options.conversationActions.activateConversation(sessionId);
  }

  async createAndActivateConversationInDirectory(
    directoryId: string,
    agentType: string,
  ): Promise<void> {
    await this.options.conversationActions.createAndActivateConversationInDirectory(
      directoryId,
      agentType,
    );
  }

  async openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void> {
    await this.options.conversationActions.openOrCreateCritiqueConversationInDirectory(directoryId);
  }

  async takeoverConversation(sessionId: string): Promise<void> {
    await this.options.conversationActions.takeoverConversation(sessionId);
  }

  async archiveConversation(sessionId: string): Promise<void> {
    await this.options.directoryActions.archiveConversation(sessionId);
  }

  async addDirectoryByPath(rawPath: string): Promise<void> {
    await this.options.directoryActions.addDirectoryByPath(rawPath);
  }

  async closeDirectory(directoryId: string): Promise<void> {
    await this.options.directoryActions.closeDirectory(directoryId);
  }

  openRepositoryPromptForCreate(): void {
    this.options.repositoryActions.openRepositoryPromptForCreate();
  }

  openRepositoryPromptForEdit(repositoryId: string): void {
    this.options.repositoryActions.openRepositoryPromptForEdit(repositoryId);
  }

  reorderRepositoryByDrop(draggedRepositoryId: string, targetRepositoryId: string): void {
    this.options.repositoryActions.reorderRepositoryByDrop(
      draggedRepositoryId,
      targetRepositoryId,
      this.options.orderedActiveRepositoryIds(),
    );
  }

  async upsertRepositoryByRemoteUrl(
    remoteUrl: string,
    existingRepositoryId?: string,
  ): Promise<void> {
    await this.options.repositoryActions.upsertRepositoryByRemoteUrl(
      remoteUrl,
      existingRepositoryId,
    );
  }

  async archiveRepositoryById(repositoryId: string): Promise<void> {
    await this.options.repositoryActions.archiveRepositoryById(repositoryId);
  }

  async interruptConversation(sessionId: string): Promise<void> {
    await this.options.controlActions.interruptConversation(sessionId);
  }

  async toggleGatewayProfiler(): Promise<void> {
    await this.options.controlActions.toggleGatewayProfiler();
  }

  async toggleGatewayStatusTimeline(): Promise<void> {
    await this.options.controlActions.toggleGatewayStatusTimeline();
  }

  async toggleGatewayRenderTrace(conversationId: string | null): Promise<void> {
    await this.options.controlActions.toggleGatewayRenderTrace(conversationId);
  }

  runTaskPaneAction(action: TaskPaneAction): void {
    this.options.taskPaneActions.runTaskPaneAction(action);
  }

  openTaskEditPrompt(taskId: string): void {
    this.options.taskPaneActions.openTaskEditPrompt(taskId);
  }

  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void {
    this.options.taskPaneActions.reorderTaskByDrop(draggedTaskId, targetTaskId);
  }

  handleTaskPaneShortcutInput(input: Buffer): boolean {
    return this.options.taskPaneShortcuts.handleInput(input);
  }
}
