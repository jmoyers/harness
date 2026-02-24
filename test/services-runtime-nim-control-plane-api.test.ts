import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { HarnessAgentRealtimeClient } from '../src/control-plane/agent-realtime-api.ts';
import { createRuntimeNimControlPlaneApi } from '../src/services/runtime-nim-control-plane-api.ts';

type MutableHarnessAgentRealtimeClientCtor = {
  connect: typeof HarnessAgentRealtimeClient.connect;
};

void test('runtime nim control-plane api proxies scoped thread/session operations', async () => {
  const connectCalls: Array<Record<string, unknown>> = [];
  const projectsListCalls: Array<Record<string, unknown>> = [];
  const repositoriesListCalls: Array<Record<string, unknown>> = [];
  const tasksListCalls: Array<Record<string, unknown>> = [];
  const threadsListCalls: Array<Record<string, unknown>> = [];
  const threadCreateCalls: Array<Record<string, unknown>> = [];
  const threadUpdateCalls: Array<{ threadId: string; input: Record<string, unknown> }> = [];
  const threadArchiveCalls: string[] = [];
  const threadDeleteCalls: string[] = [];
  const threadStatusCalls: string[] = [];
  const startCalls: Array<Record<string, unknown>> = [];
  const attachCalls: Array<{ sessionId: string; sinceCursor?: number }> = [];
  const detachCalls: string[] = [];
  const subscribeCalls: string[] = [];
  const unsubscribeCalls: string[] = [];
  const snapshotCalls: Array<{ sessionId: string; tailLines?: number }> = [];
  const respondCalls: Array<{ sessionId: string; text: string }> = [];
  const interruptCalls: string[] = [];
  const claimCalls: Array<Record<string, unknown>> = [];
  const releaseCalls: Array<Record<string, unknown>> = [];
  const closeSessionCalls: string[] = [];
  const removeCalls: string[] = [];
  const sessionsListCalls: Array<Record<string, unknown>> = [];
  let closeCalls = 0;

  const fakeRealtimeClient = {
    projects: {
      list: async (query: Record<string, unknown>) => {
        projectsListCalls.push(query);
        return [{ projectId: 'project-1' }];
      },
    },
    repositories: {
      list: async (query: Record<string, unknown>) => {
        repositoriesListCalls.push(query);
        return [{ repositoryId: 'repository-1' }];
      },
    },
    tasks: {
      list: async (query: Record<string, unknown>) => {
        tasksListCalls.push(query);
        return [{ taskId: 'task-1' }];
      },
    },
    threads: {
      list: async (query: Record<string, unknown>) => {
        threadsListCalls.push(query);
        return [{ threadId: 'thread-1' }];
      },
      create: async (input: Record<string, unknown>) => {
        threadCreateCalls.push(input);
        return {
          threadId: String(input['threadId'] ?? 'thread-created'),
          title: input['title'],
          projectId: input['projectId'],
          agentType: input['agentType'],
        };
      },
      update: async (threadId: string, input: Record<string, unknown>) => {
        threadUpdateCalls.push({ threadId, input });
        return {
          threadId,
          title: input['title'],
        };
      },
      archive: async (threadId: string) => {
        threadArchiveCalls.push(threadId);
        return {
          threadId,
          archivedAt: '2026-01-01T00:00:00.000Z',
        };
      },
      delete: async (threadId: string) => {
        threadDeleteCalls.push(threadId);
        return {
          deleted: true,
        };
      },
      status: async (threadId: string) => {
        threadStatusCalls.push(threadId);
        return {
          sessionId: threadId,
          status: 'running',
        };
      },
    },
    sessions: {
      start: async (input: Record<string, unknown>) => {
        startCalls.push(input);
        return {
          sessionId: String(input['sessionId']),
        };
      },
      attach: async (sessionId: string, sinceCursor?: number) => {
        attachCalls.push({
          sessionId,
          ...(sinceCursor === undefined ? {} : { sinceCursor }),
        });
        return {
          latestCursor: 9,
        };
      },
      detach: async (sessionId: string) => {
        detachCalls.push(sessionId);
        return {
          detached: true,
        };
      },
      subscribeEvents: async (sessionId: string) => {
        subscribeCalls.push(sessionId);
        return {
          subscribed: true,
        };
      },
      unsubscribeEvents: async (sessionId: string) => {
        unsubscribeCalls.push(sessionId);
        return {
          subscribed: false,
        };
      },
      snapshot: async (sessionId: string, tailLines?: number) => {
        snapshotCalls.push({
          sessionId,
          ...(tailLines === undefined ? {} : { tailLines }),
        });
        return {
          sessionId,
          snapshot: {},
          stale: false,
          buffer: null,
        };
      },
      respond: async (sessionId: string, text: string) => {
        respondCalls.push({
          sessionId,
          text,
        });
        return {
          responded: true,
          sentBytes: text.length,
        };
      },
      interrupt: async (sessionId: string) => {
        interruptCalls.push(sessionId);
        return {
          interrupted: true,
        };
      },
      claim: async (input: Record<string, unknown>) => {
        claimCalls.push(input);
        return {
          sessionId: String(input['sessionId']),
          action: 'claimed',
          controller: {
            controllerId: 'nim',
            controllerType: 'agent',
            controllerLabel: 'nim',
            claimedAt: '2026-01-01T00:00:00.000Z',
          },
        };
      },
      release: async (input: Record<string, unknown>) => {
        releaseCalls.push(input);
        return {
          sessionId: String(input['sessionId']),
          released: true,
        };
      },
      close: async (sessionId: string) => {
        closeSessionCalls.push(sessionId);
        return {
          closed: true,
        };
      },
      remove: async (sessionId: string) => {
        removeCalls.push(sessionId);
        return {
          removed: true,
        };
      },
      list: async (query: Record<string, unknown>) => {
        sessionsListCalls.push(query);
        return [{ sessionId: 'session-1' }];
      },
    },
    close: async () => {
      closeCalls += 1;
    },
  } as unknown as HarnessAgentRealtimeClient;

  const originalConnect = HarnessAgentRealtimeClient.connect;
  (HarnessAgentRealtimeClient as unknown as MutableHarnessAgentRealtimeClientCtor).connect = async (
    options,
  ) => {
    connectCalls.push(options as unknown as Record<string, unknown>);
    return fakeRealtimeClient;
  };

  try {
    const api = createRuntimeNimControlPlaneApi({
      host: '127.0.0.1',
      port: 7788,
      authToken: 'auth-token',
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
    });

    await api.listDirectories();
    await api.listRepositories();
    await api.listTasks(55);
    await api.listThreads({ includeArchived: true, limit: 12 });
    await api.createThread({
      projectId: 'project-1',
      title: 'thread title',
      agentType: 'nim',
    });
    await api.updateThread({
      threadId: 'thread-1',
      title: 'updated',
    });
    await api.archiveThread('thread-1');
    await api.deleteThread('thread-1');
    await api.threadStatus('thread-1');
    await api.threadStart({
      threadId: 'thread-1',
      args: ['--mock'],
      initialCols: 140,
      initialRows: 44,
    });
    await api.threadAttach({
      threadId: 'thread-1',
      sinceCursor: 3,
    });
    await api.threadDetach('thread-1');
    await api.threadSubscribeEvents('thread-1');
    await api.threadUnsubscribeEvents('thread-1');
    await api.threadSnapshot({ threadId: 'thread-1', tailLines: 25 });
    await api.threadRespond({ threadId: 'thread-1', text: 'respond' });
    await api.threadInterrupt('thread-1');
    await api.threadClaim({
      sessionId: 'thread-1',
      controllerId: 'nim',
      controllerType: 'agent',
    });
    await api.threadRelease({
      threadId: 'thread-1',
      reason: 'done',
    });
    await api.threadClose('thread-1');
    await api.threadRemove('thread-1');
    await api.listSessions();
    await api.close();
  } finally {
    (HarnessAgentRealtimeClient as unknown as MutableHarnessAgentRealtimeClientCtor).connect =
      originalConnect;
  }

  assert.equal(connectCalls.length, 1);
  assert.equal(projectsListCalls[0]?.tenantId, 'tenant-a');
  assert.equal(repositoriesListCalls[0]?.workspaceId, 'workspace-a');
  assert.equal(tasksListCalls[0]?.limit, 55);
  assert.equal(threadsListCalls[0]?.limit, 12);
  assert.equal(threadCreateCalls[0]?.projectId, 'project-1');
  assert.equal(threadUpdateCalls[0]?.threadId, 'thread-1');
  assert.equal(threadArchiveCalls[0], 'thread-1');
  assert.equal(threadDeleteCalls[0], 'thread-1');
  assert.equal(threadStatusCalls[0], 'thread-1');
  assert.equal(startCalls[0]?.sessionId, 'thread-1');
  assert.equal(startCalls[0]?.initialCols, 140);
  assert.equal(startCalls[0]?.tenantId, 'tenant-a');
  assert.equal(attachCalls[0]?.sinceCursor, 3);
  assert.equal(detachCalls[0], 'thread-1');
  assert.equal(subscribeCalls[0], 'thread-1');
  assert.equal(unsubscribeCalls[0], 'thread-1');
  assert.equal(snapshotCalls[0]?.tailLines, 25);
  assert.equal(respondCalls[0]?.text, 'respond');
  assert.equal(interruptCalls[0], 'thread-1');
  assert.equal(claimCalls[0]?.sessionId, 'thread-1');
  assert.equal(releaseCalls[0]?.reason, 'done');
  assert.equal(closeSessionCalls[0], 'thread-1');
  assert.equal(removeCalls[0], 'thread-1');
  assert.equal(sessionsListCalls[0]?.tenantId, 'tenant-a');
  assert.equal(closeCalls, 1);
});

void test('runtime nim control-plane api rejects calls after close', async () => {
  const api = createRuntimeNimControlPlaneApi({
    host: '127.0.0.1',
    port: 7788,
    tenantId: 'tenant-a',
    userId: 'user-a',
    workspaceId: 'workspace-a',
  });
  await api.close();
  await assert.rejects(async () => await api.listSessions(), /is closed/);
});
