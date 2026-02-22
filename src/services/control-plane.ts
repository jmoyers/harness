import type {
  StreamCommand,
  StreamSessionControllerType,
  StreamSessionListSort,
} from '../control-plane/stream-protocol.ts';
import {
  parseSessionSummaryList,
  parseSessionSummaryRecord,
} from '../control-plane/session-summary.ts';
import {
  type ControlPlaneConversationRecord,
  type ControlPlaneDirectoryGitStatusRecord,
  type ControlPlaneDirectoryRecord,
  type ControlPlaneRepositoryRecord,
  type ControlPlaneTaskRecord,
  parseConversationRecord,
  parseDirectoryGitStatusRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
  parseSessionControllerRecord,
  parseTaskRecord,
} from '../core/contracts/records.ts';

interface ControlPlaneScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface ControlPlaneCommandClient {
  sendCommand(command: StreamCommand): Promise<Record<string, unknown>>;
}

type ControlPlaneSessionControllerRecord = NonNullable<
  ReturnType<typeof parseSessionControllerRecord>
>;
type ControlPlaneSessionSummary = NonNullable<ReturnType<typeof parseSessionSummaryRecord>>;

export class ControlPlaneService {
  constructor(
    private readonly client: ControlPlaneCommandClient,
    private readonly scope: ControlPlaneScope,
  ) {}

  async listRepositories(): Promise<readonly ControlPlaneRepositoryRecord[]> {
    const result = await this.client.sendCommand({
      type: 'repository.list',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    });
    const rawRepositories = result['repositories'];
    if (!Array.isArray(rawRepositories)) {
      throw new Error('control-plane repository.list returned malformed repositories');
    }
    const repositories: ControlPlaneRepositoryRecord[] = [];
    for (const value of rawRepositories) {
      const parsed = parseRepositoryRecord(value);
      if (parsed === null) {
        throw new Error('control-plane repository.list returned malformed repository record');
      }
      repositories.push(parsed);
    }
    return repositories;
  }

  async upsertRepository(input: {
    repositoryId?: string;
    name: string;
    remoteUrl: string;
    defaultBranch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ControlPlaneRepositoryRecord> {
    const command: StreamCommand = {
      type: 'repository.upsert',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      name: input.name,
      remoteUrl: input.remoteUrl,
    };
    if (input.repositoryId !== undefined) {
      command.repositoryId = input.repositoryId;
    }
    if (input.defaultBranch !== undefined) {
      command.defaultBranch = input.defaultBranch;
    }
    if (input.metadata !== undefined) {
      command.metadata = input.metadata;
    }
    const result = await this.client.sendCommand(command);
    const parsed = parseRepositoryRecord(result['repository']);
    if (parsed === null) {
      throw new Error('control-plane repository.upsert returned malformed repository record');
    }
    return parsed;
  }

  async updateRepository(input: {
    repositoryId: string;
    name?: string;
    remoteUrl?: string;
    defaultBranch?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ControlPlaneRepositoryRecord> {
    const command: StreamCommand = {
      type: 'repository.update',
      repositoryId: input.repositoryId,
    };
    if (input.name !== undefined) {
      command.name = input.name;
    }
    if (input.remoteUrl !== undefined) {
      command.remoteUrl = input.remoteUrl;
    }
    if (input.defaultBranch !== undefined) {
      command.defaultBranch = input.defaultBranch;
    }
    if (input.metadata !== undefined) {
      command.metadata = input.metadata;
    }
    const result = await this.client.sendCommand(command);
    const parsed = parseRepositoryRecord(result['repository']);
    if (parsed === null) {
      throw new Error('control-plane repository.update returned malformed repository record');
    }
    return parsed;
  }

  async archiveRepository(repositoryId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'repository.archive',
      repositoryId,
    });
  }

  async upsertDirectory(input: {
    directoryId: string;
    path: string;
  }): Promise<ControlPlaneDirectoryRecord> {
    const result = await this.client.sendCommand({
      type: 'directory.upsert',
      directoryId: input.directoryId,
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      path: input.path,
    });
    const parsed = parseDirectoryRecord(result['directory']);
    if (parsed === null) {
      throw new Error('control-plane directory.upsert returned malformed directory record');
    }
    return parsed;
  }

  async listDirectories(): Promise<readonly ControlPlaneDirectoryRecord[]> {
    const result = await this.client.sendCommand({
      type: 'directory.list',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    });
    const rows = Array.isArray(result['directories']) ? result['directories'] : [];
    const directories: ControlPlaneDirectoryRecord[] = [];
    for (const row of rows) {
      const parsed = parseDirectoryRecord(row);
      if (parsed !== null) {
        directories.push(parsed);
      }
    }
    return directories;
  }

  async listDirectoryGitStatuses(input?: {
    directoryId?: string;
  }): Promise<readonly ControlPlaneDirectoryGitStatusRecord[]> {
    const command: StreamCommand = {
      type: 'directory.git-status',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    };
    if (input?.directoryId !== undefined) {
      command.directoryId = input.directoryId;
    }
    const result = await this.client.sendCommand(command);
    const rows = Array.isArray(result['gitStatuses']) ? result['gitStatuses'] : [];
    const statuses: ControlPlaneDirectoryGitStatusRecord[] = [];
    for (const row of rows) {
      const parsed = parseDirectoryGitStatusRecord(row);
      if (parsed !== null) {
        statuses.push(parsed);
      }
    }
    return statuses;
  }

  async listConversations(directoryId: string): Promise<readonly ControlPlaneConversationRecord[]> {
    const result = await this.client.sendCommand({
      type: 'conversation.list',
      directoryId,
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    });
    const rows = Array.isArray(result['conversations']) ? result['conversations'] : [];
    const conversations: ControlPlaneConversationRecord[] = [];
    for (const row of rows) {
      const parsed = parseConversationRecord(row);
      if (parsed !== null) {
        conversations.push(parsed);
      }
    }
    return conversations;
  }

  async createConversation(input: {
    conversationId: string;
    directoryId: string;
    title: string;
    agentType: string;
    adapterState: Record<string, unknown>;
  }): Promise<void> {
    await this.client.sendCommand({
      type: 'conversation.create',
      conversationId: input.conversationId,
      directoryId: input.directoryId,
      title: input.title,
      agentType: input.agentType,
      adapterState: input.adapterState,
    });
  }

  async updateConversationTitle(input: {
    conversationId: string;
    title: string;
  }): Promise<ControlPlaneConversationRecord | null> {
    const result = await this.client.sendCommand({
      type: 'conversation.update',
      conversationId: input.conversationId,
      title: input.title,
    });
    return parseConversationRecord(result['conversation']);
  }

  async refreshConversationTitle(conversationId: string): Promise<{
    status: 'updated' | 'unchanged' | 'skipped';
    reason: string | null;
  }> {
    const result = await this.client.sendCommand({
      type: 'conversation.title.refresh',
      conversationId,
    });
    const status = result['status'];
    if (status !== 'updated' && status !== 'unchanged' && status !== 'skipped') {
      throw new Error('control-plane conversation.title.refresh returned malformed status');
    }
    const reason = result['reason'];
    if (reason !== null && reason !== undefined && typeof reason !== 'string') {
      throw new Error('control-plane conversation.title.refresh returned malformed reason');
    }
    return {
      status,
      reason: reason ?? null,
    };
  }

  async archiveConversation(conversationId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'conversation.archive',
      conversationId,
    });
  }

  async archiveDirectory(directoryId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'directory.archive',
      directoryId,
    });
  }

  async attachPty(input: { sessionId: string; sinceCursor: number }): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.attach',
      sessionId: input.sessionId,
      sinceCursor: input.sinceCursor,
    });
  }

  async detachPty(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.detach',
      sessionId,
    });
  }

  async subscribePtyEvents(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId,
    });
  }

  async unsubscribePtyEvents(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.unsubscribe-events',
      sessionId,
    });
  }

  async startPtySession(input: {
    sessionId: string;
    args: readonly string[];
    env?: Record<string, string>;
    cwd?: string;
    initialCols: number;
    initialRows: number;
    terminalForegroundHex?: string;
    terminalBackgroundHex?: string;
    worktreeId?: string;
  }): Promise<void> {
    const command: StreamCommand = {
      type: 'pty.start',
      sessionId: input.sessionId,
      args: [...input.args],
      initialCols: input.initialCols,
      initialRows: input.initialRows,
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    };
    if (input.env !== undefined) {
      command.env = input.env;
    }
    if (input.cwd !== undefined) {
      command.cwd = input.cwd;
    }
    if (input.terminalForegroundHex !== undefined) {
      command.terminalForegroundHex = input.terminalForegroundHex;
    }
    if (input.terminalBackgroundHex !== undefined) {
      command.terminalBackgroundHex = input.terminalBackgroundHex;
    }
    if (input.worktreeId !== undefined) {
      command.worktreeId = input.worktreeId;
    }
    await this.client.sendCommand(command);
  }

  async closePtySession(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.close',
      sessionId,
    });
  }

  async getSessionStatus(sessionId: string): Promise<ControlPlaneSessionSummary | null> {
    const result = await this.client.sendCommand({
      type: 'session.status',
      sessionId,
    });
    return parseSessionSummaryRecord(result);
  }

  async listSessions(input?: {
    sort?: StreamSessionListSort;
    worktreeId?: string;
  }): Promise<readonly ControlPlaneSessionSummary[]> {
    const command: StreamCommand = {
      type: 'session.list',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    };
    if (input?.sort !== undefined) {
      command.sort = input.sort;
    }
    if (input?.worktreeId !== undefined) {
      command.worktreeId = input.worktreeId;
    }
    const result = await this.client.sendCommand(command);
    return parseSessionSummaryList(result['sessions']);
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'session.remove',
      sessionId,
    });
  }

  async claimSession(input: {
    sessionId: string;
    controllerId: string;
    controllerType: StreamSessionControllerType;
    controllerLabel: string;
    reason: string;
    takeover: boolean;
  }): Promise<ControlPlaneSessionControllerRecord | null> {
    const result = await this.client.sendCommand({
      type: 'session.claim',
      sessionId: input.sessionId,
      controllerId: input.controllerId,
      controllerType: input.controllerType,
      controllerLabel: input.controllerLabel,
      reason: input.reason,
      takeover: input.takeover,
    });
    return parseSessionControllerRecord(result['controller']);
  }

  async respondToSession(
    sessionId: string,
    text: string,
  ): Promise<{ responded: boolean; sentBytes: number }> {
    const result = await this.client.sendCommand({
      type: 'session.respond',
      sessionId,
      text,
    });
    const responded = result['responded'];
    const sentBytes = result['sentBytes'];
    if (typeof responded !== 'boolean' || typeof sentBytes !== 'number') {
      throw new Error('control-plane session.respond returned malformed response');
    }
    return {
      responded,
      sentBytes,
    };
  }

  async interruptSession(sessionId: string): Promise<{ interrupted: boolean }> {
    const result = await this.client.sendCommand({
      type: 'session.interrupt',
      sessionId,
    });
    const interrupted = result['interrupted'];
    if (typeof interrupted !== 'boolean') {
      throw new Error('control-plane session.interrupt returned malformed response');
    }
    return {
      interrupted,
    };
  }

  async listTasks(limit = 1000): Promise<readonly ControlPlaneTaskRecord[]> {
    const result = await this.client.sendCommand({
      type: 'task.list',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      limit,
    });
    return this.parseTaskListFromResult(
      result,
      'control-plane task.list returned malformed tasks',
      'control-plane task.list returned malformed task record',
    );
  }

  async createTask(input: {
    repositoryId?: string;
    projectId?: string;
    title?: string | null;
    body: string;
  }): Promise<ControlPlaneTaskRecord> {
    const command: StreamCommand = {
      type: 'task.create',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      body: input.body,
    };
    if (input.repositoryId !== undefined) {
      command.repositoryId = input.repositoryId;
    }
    if (input.projectId !== undefined) {
      command.projectId = input.projectId;
    }
    if (input.title !== undefined) {
      command.title = input.title;
    }
    const result = await this.client.sendCommand(command);
    return this.parseTaskFromResult(
      result,
      'control-plane task.create returned malformed task record',
    );
  }

  async updateTask(input: {
    taskId: string;
    repositoryId?: string | null;
    projectId?: string | null;
    title?: string | null;
    body?: string;
  }): Promise<ControlPlaneTaskRecord> {
    const command: StreamCommand = {
      type: 'task.update',
      taskId: input.taskId,
    };
    if (input.repositoryId !== undefined) {
      command.repositoryId = input.repositoryId;
    }
    if (input.projectId !== undefined) {
      command.projectId = input.projectId;
    }
    if (input.title !== undefined) {
      command.title = input.title;
    }
    if (input.body !== undefined) {
      command.body = input.body;
    }
    const result = await this.client.sendCommand(command);
    return this.parseTaskFromResult(
      result,
      'control-plane task.update returned malformed task record',
    );
  }

  async taskReady(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.ready',
      taskId,
    });
    return this.parseTaskFromResult(
      result,
      'control-plane task.ready returned malformed task record',
    );
  }

  async taskDraft(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.draft',
      taskId,
    });
    return this.parseTaskFromResult(
      result,
      'control-plane task.draft returned malformed task record',
    );
  }

  async taskComplete(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.complete',
      taskId,
    });
    return this.parseTaskFromResult(
      result,
      'control-plane task.complete returned malformed task record',
    );
  }

  async reorderTasks(
    orderedTaskIds: readonly string[],
  ): Promise<readonly ControlPlaneTaskRecord[]> {
    const result = await this.client.sendCommand({
      type: 'task.reorder',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      orderedTaskIds: [...orderedTaskIds],
    });
    return this.parseTaskListFromResult(
      result,
      'control-plane task.reorder returned malformed tasks',
      'control-plane task.reorder returned malformed task record',
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'task.delete',
      taskId,
    });
  }

  private parseTaskFromResult(
    result: Record<string, unknown>,
    malformedTaskError: string,
  ): ControlPlaneTaskRecord {
    const parsed = parseTaskRecord(result['task']);
    if (parsed === null) {
      throw new Error(malformedTaskError);
    }
    return parsed;
  }

  private parseTaskListFromResult(
    result: Record<string, unknown>,
    malformedListError: string,
    malformedRecordError: string,
  ): readonly ControlPlaneTaskRecord[] {
    const rawTasks = result['tasks'];
    if (!Array.isArray(rawTasks)) {
      throw new Error(malformedListError);
    }
    const tasks: ControlPlaneTaskRecord[] = [];
    for (const value of rawTasks) {
      const parsed = parseTaskRecord(value);
      if (parsed === null) {
        throw new Error(malformedRecordError);
      }
      tasks.push(parsed);
    }
    return tasks;
  }
}
