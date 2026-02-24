import {
  HarnessAgentRealtimeClient,
  type AgentClaimSessionInput,
  type AgentSessionClaimResult,
  type AgentSessionReleaseResult,
  type AgentSessionSnapshot,
  type AgentSessionSummary,
  type AgentTask,
  type AgentThread,
  type AgentThreadListQuery,
} from '../control-plane/agent-realtime-api.ts';

export interface RuntimeNimControlPlaneApi {
  listDirectories(): Promise<readonly unknown[]>;
  listRepositories(): Promise<readonly unknown[]>;
  listTasks(limit: number): Promise<readonly AgentTask[]>;
  listThreads(query: AgentThreadListQuery): Promise<readonly AgentThread[]>;
  createThread(input: {
    threadId?: string;
    projectId: string;
    title: string;
    agentType: string;
    adapterState?: Record<string, unknown>;
  }): Promise<AgentThread>;
  updateThread(input: { threadId: string; title: string }): Promise<AgentThread>;
  archiveThread(threadId: string): Promise<AgentThread>;
  deleteThread(threadId: string): Promise<{ deleted: boolean }>;
  threadStatus(threadId: string): Promise<AgentSessionSummary>;
  threadSnapshot(input: { threadId: string; tailLines?: number }): Promise<AgentSessionSnapshot>;
  threadRespond(input: { threadId: string; text: string }): Promise<{
    responded: boolean;
    sentBytes: number;
  }>;
  threadInterrupt(threadId: string): Promise<{ interrupted: boolean }>;
  threadClaim(input: AgentClaimSessionInput): Promise<AgentSessionClaimResult>;
  threadRelease(input: { threadId: string; reason?: string }): Promise<AgentSessionReleaseResult>;
  threadStart(input: {
    threadId: string;
    args?: readonly string[];
    env?: Record<string, string>;
    cwd?: string;
    initialCols?: number;
    initialRows?: number;
    worktreeId?: string;
  }): Promise<{ sessionId: string }>;
  threadAttach(input: {
    threadId: string;
    sinceCursor?: number;
  }): Promise<{ latestCursor: number }>;
  threadDetach(threadId: string): Promise<{ detached: boolean }>;
  threadSubscribeEvents(threadId: string): Promise<{ subscribed: boolean }>;
  threadUnsubscribeEvents(threadId: string): Promise<{ subscribed: boolean }>;
  threadClose(threadId: string): Promise<{ closed: boolean }>;
  threadRemove(threadId: string): Promise<{ removed: boolean }>;
  listSessions(): Promise<readonly AgentSessionSummary[]>;
  close(): Promise<void>;
}

interface RuntimeNimControlPlaneApiScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface RuntimeNimControlPlaneApiOptions extends RuntimeNimControlPlaneApiScope {
  readonly host: string;
  readonly port: number;
  readonly authToken?: string;
  readonly connectRetryWindowMs?: number;
  readonly connectRetryDelayMs?: number;
}

export function createRuntimeNimControlPlaneApi(
  options: RuntimeNimControlPlaneApiOptions,
): RuntimeNimControlPlaneApi {
  let clientPromise: Promise<HarnessAgentRealtimeClient> | null = null;
  let closed = false;

  const getClient = async (): Promise<HarnessAgentRealtimeClient> => {
    if (closed) {
      throw new Error('runtime nim control-plane api is closed');
    }
    if (clientPromise === null) {
      clientPromise = HarnessAgentRealtimeClient.connect({
        host: options.host,
        port: options.port,
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.connectRetryWindowMs === undefined
          ? {}
          : { connectRetryWindowMs: options.connectRetryWindowMs }),
        ...(options.connectRetryDelayMs === undefined
          ? {}
          : { connectRetryDelayMs: options.connectRetryDelayMs }),
        subscription: {
          tenantId: options.tenantId,
          userId: options.userId,
          workspaceId: options.workspaceId,
          includeOutput: false,
        },
      });
    }
    return await clientPromise;
  };

  return {
    listDirectories: async (): Promise<readonly unknown[]> => {
      const client = await getClient();
      return await client.projects.list({
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
      });
    },
    listRepositories: async (): Promise<readonly unknown[]> => {
      const client = await getClient();
      return await client.repositories.list({
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
      });
    },
    listTasks: async (limit: number): Promise<readonly AgentTask[]> => {
      const client = await getClient();
      return await client.tasks.list({
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
        limit,
      });
    },
    listThreads: async (query: AgentThreadListQuery): Promise<readonly AgentThread[]> => {
      const client = await getClient();
      return await client.threads.list({
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
        ...(query.includeArchived === undefined ? {} : { includeArchived: query.includeArchived }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
    },
    createThread: async (input: {
      threadId?: string;
      projectId: string;
      title: string;
      agentType: string;
      adapterState?: Record<string, unknown>;
    }): Promise<AgentThread> => {
      const client = await getClient();
      return await client.threads.create({
        projectId: input.projectId,
        title: input.title,
        agentType: input.agentType,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(input.adapterState === undefined ? {} : { adapterState: input.adapterState }),
      });
    },
    updateThread: async (input: { threadId: string; title: string }): Promise<AgentThread> => {
      const client = await getClient();
      return await client.threads.update(input.threadId, {
        title: input.title,
      });
    },
    archiveThread: async (threadId: string): Promise<AgentThread> => {
      const client = await getClient();
      return await client.threads.archive(threadId);
    },
    deleteThread: async (threadId: string): Promise<{ deleted: boolean }> => {
      const client = await getClient();
      return await client.threads.delete(threadId);
    },
    threadStatus: async (threadId: string): Promise<AgentSessionSummary> => {
      const client = await getClient();
      return await client.threads.status(threadId);
    },
    threadSnapshot: async (input: {
      threadId: string;
      tailLines?: number;
    }): Promise<AgentSessionSnapshot> => {
      const client = await getClient();
      return await client.sessions.snapshot(input.threadId, input.tailLines);
    },
    threadRespond: async (input: {
      threadId: string;
      text: string;
    }): Promise<{
      responded: boolean;
      sentBytes: number;
    }> => {
      const client = await getClient();
      return await client.sessions.respond(input.threadId, input.text);
    },
    threadInterrupt: async (threadId: string): Promise<{ interrupted: boolean }> => {
      const client = await getClient();
      return await client.sessions.interrupt(threadId);
    },
    threadClaim: async (input: AgentClaimSessionInput): Promise<AgentSessionClaimResult> => {
      const client = await getClient();
      return await client.sessions.claim(input);
    },
    threadRelease: async (input: {
      threadId: string;
      reason?: string;
    }): Promise<AgentSessionReleaseResult> => {
      const client = await getClient();
      return await client.sessions.release({
        sessionId: input.threadId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });
    },
    threadStart: async (input: {
      threadId: string;
      args?: readonly string[];
      env?: Record<string, string>;
      cwd?: string;
      initialCols?: number;
      initialRows?: number;
      worktreeId?: string;
    }): Promise<{ sessionId: string }> => {
      const client = await getClient();
      return await client.sessions.start({
        sessionId: input.threadId,
        args: [...(input.args ?? [])],
        initialCols: input.initialCols ?? 120,
        initialRows: input.initialRows ?? 40,
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
        ...(input.env === undefined ? {} : { env: input.env }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
      });
    },
    threadAttach: async (input: {
      threadId: string;
      sinceCursor?: number;
    }): Promise<{ latestCursor: number }> => {
      const client = await getClient();
      return await client.sessions.attach(input.threadId, input.sinceCursor);
    },
    threadDetach: async (threadId: string): Promise<{ detached: boolean }> => {
      const client = await getClient();
      return await client.sessions.detach(threadId);
    },
    threadSubscribeEvents: async (threadId: string): Promise<{ subscribed: boolean }> => {
      const client = await getClient();
      return await client.sessions.subscribeEvents(threadId);
    },
    threadUnsubscribeEvents: async (threadId: string): Promise<{ subscribed: boolean }> => {
      const client = await getClient();
      return await client.sessions.unsubscribeEvents(threadId);
    },
    threadClose: async (threadId: string): Promise<{ closed: boolean }> => {
      const client = await getClient();
      return await client.sessions.close(threadId);
    },
    threadRemove: async (threadId: string): Promise<{ removed: boolean }> => {
      const client = await getClient();
      return await client.sessions.remove(threadId);
    },
    listSessions: async (): Promise<readonly AgentSessionSummary[]> => {
      const client = await getClient();
      return await client.sessions.list({
        tenantId: options.tenantId,
        userId: options.userId,
        workspaceId: options.workspaceId,
      });
    },
    close: async (): Promise<void> => {
      closed = true;
      if (clientPromise === null) {
        return;
      }
      const client = await clientPromise;
      await client.close();
    },
  };
}
