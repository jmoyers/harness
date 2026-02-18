import type { StreamCommand, StreamSessionControllerType } from '../control-plane/stream-protocol.ts';
import {
  parseConversationRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
  parseSessionControllerRecord,
  parseTaskRecord,
} from '../mux/live-mux/control-plane-records.ts';

interface ControlPlaneScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

interface ControlPlaneCommandClient {
  sendCommand(command: StreamCommand): Promise<Record<string, unknown>>;
}

type ControlPlaneRepositoryRecord = NonNullable<ReturnType<typeof parseRepositoryRecord>>;
type ControlPlaneTaskRecord = NonNullable<ReturnType<typeof parseTaskRecord>>;
type ControlPlaneDirectoryRecord = NonNullable<ReturnType<typeof parseDirectoryRecord>>;
type ControlPlaneConversationRecord = NonNullable<ReturnType<typeof parseConversationRecord>>;
type ControlPlaneSessionControllerRecord = NonNullable<ReturnType<typeof parseSessionControllerRecord>>;

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

  async attachPty(input: {
    sessionId: string;
    sinceCursor: number;
  }): Promise<void> {
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

  async closePtySession(sessionId: string): Promise<void> {
    await this.client.sendCommand({
      type: 'pty.close',
      sessionId,
    });
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
    repositoryId: string;
    title: string;
    description: string;
  }): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.create',
      tenantId: this.scope.tenantId,
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
      repositoryId: input.repositoryId,
      title: input.title,
      description: input.description,
    });
    return this.parseTaskFromResult(result, 'control-plane task.create returned malformed task record');
  }

  async updateTask(input: {
    taskId: string;
    repositoryId: string | null;
    title: string;
    description: string;
  }): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.update',
      taskId: input.taskId,
      repositoryId: input.repositoryId,
      title: input.title,
      description: input.description,
    });
    return this.parseTaskFromResult(result, 'control-plane task.update returned malformed task record');
  }

  async taskReady(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.ready',
      taskId,
    });
    return this.parseTaskFromResult(result, 'control-plane task.ready returned malformed task record');
  }

  async taskDraft(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.draft',
      taskId,
    });
    return this.parseTaskFromResult(result, 'control-plane task.draft returned malformed task record');
  }

  async taskComplete(taskId: string): Promise<ControlPlaneTaskRecord> {
    const result = await this.client.sendCommand({
      type: 'task.complete',
      taskId,
    });
    return this.parseTaskFromResult(result, 'control-plane task.complete returned malformed task record');
  }

  async reorderTasks(orderedTaskIds: readonly string[]): Promise<readonly ControlPlaneTaskRecord[]> {
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
