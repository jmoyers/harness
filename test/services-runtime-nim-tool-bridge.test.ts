import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeNimToolBridge } from '../src/services/runtime-nim-tool-bridge.ts';

function createBridge(): RuntimeNimToolBridge {
  return new RuntimeNimToolBridge({
    listDirectories: async () => [{ directoryId: 'dir-1' }],
    listRepositories: async () => [{ repositoryId: 'repo-1' }],
    listTasks: async (limit) => [{ taskId: `task-${String(limit)}` }],
    listThreads: async () => [
      {
        threadId: 'thread-1',
        agentType: 'codex',
        runtimeStatus: 'running',
      },
      {
        threadId: 'thread-2',
        agentType: 'nim',
        runtimeStatus: 'needs-input',
      },
    ],
    createThread: async (input) => ({
      threadId: input.threadId ?? 'thread-new',
      projectId: input.projectId,
      title: input.title,
      agentType: input.agentType,
    }),
    updateThread: async (input) => ({
      threadId: input.threadId,
      title: input.title,
    }),
    archiveThread: async (threadId) => ({
      threadId,
      archived: true,
    }),
    threadStatus: async (threadId) => ({
      sessionId: threadId,
      status: 'running',
    }),
    threadSnapshot: async ({ threadId, tailLines }) => ({
      sessionId: threadId,
      tailLines,
    }),
    threadRespond: async ({ threadId, text }) => ({
      responded: true,
      sentBytes: Buffer.byteLength(`${threadId}:${text}`),
    }),
    threadInterrupt: async () => ({
      interrupted: true,
    }),
    threadClaim: async (input) => ({
      sessionId: input.threadId,
      action: input.takeover === true ? 'taken-over' : 'claimed',
      controller: {
        controllerId: input.controllerId,
      },
    }),
    threadRelease: async (input) => ({
      sessionId: input.threadId,
      released: input.reason !== 'deny',
    }),
    threadStart: async (input) => ({
      sessionId: input.threadId,
    }),
    threadAttach: async (input) => ({
      latestCursor: input.sinceCursor ?? 0,
    }),
    threadDetach: async () => ({
      detached: true,
    }),
    threadSubscribeEvents: async () => ({
      subscribed: true,
    }),
    threadUnsubscribeEvents: async () => ({
      subscribed: false,
    }),
    threadClose: async () => ({
      closed: true,
    }),
    threadRemove: async () => ({
      removed: true,
    }),
    listSessions: async () => [{ sessionId: 'session-1' }],
  });
}

void test('runtime nim tool bridge registers control-plane tools and policy', () => {
  const registeredTools: string[] = [];
  let threadRespondSchema: Record<string, unknown> | null = null;
  let policyHash = '';
  const bridge = createBridge();

  bridge.registerWithRuntime({
    registerTools: (tools) => {
      for (const tool of tools) {
        registeredTools.push(tool.name);
        if (tool.name === 'thread.respond') {
          threadRespondSchema = (tool.inputSchema ?? null) as Record<string, unknown> | null;
        }
      }
    },
    setToolPolicy: (policy) => {
      policyHash = policy.hash;
      assert.deepEqual(policy.deny, []);
      assert.deepEqual(policy.allow, registeredTools);
    },
  });

  assert.deepEqual(registeredTools, [
    'directory.list',
    'repository.list',
    'task.list',
    'thread.list',
    'thread.create',
    'thread.update',
    'thread.archive',
    'thread.status',
    'thread.snapshot',
    'thread.respond',
    'thread.interrupt',
    'thread.claim',
    'thread.release',
    'thread.start',
    'thread.attach',
    'thread.detach',
    'thread.events.subscribe',
    'thread.events.unsubscribe',
    'thread.close',
    'thread.remove',
    'session.list',
  ]);
  assert.equal(policyHash, 'nim-control-plane-tools-v5');
  assert.equal(threadRespondSchema !== null, true);
  const threadRespondProperties = threadRespondSchema?.['properties'] as
    | Record<string, unknown>
    | undefined;
  assert.equal(typeof threadRespondProperties?.['threadId'], 'object');
  assert.equal(typeof threadRespondProperties?.['text'], 'object');
});

void test('runtime nim tool bridge invokes thread control and inspection tools', async () => {
  const bridge = createBridge();

  assert.deepEqual(
    await bridge.invoke({
      toolName: 'directory.list',
      argumentsText: '',
    }),
    {
      count: 1,
      directories: [{ directoryId: 'dir-1' }],
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'repository.list',
      argumentsText: '',
    }),
    {
      count: 1,
      repositories: [{ repositoryId: 'repo-1' }],
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'task.list',
      argumentsText: '25',
    }),
    {
      count: 1,
      limit: 25,
      tasks: [{ taskId: 'task-25' }],
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'task.list',
      argumentsValue: {
        limit: 7,
      },
    }),
    {
      count: 1,
      limit: 7,
      tasks: [{ taskId: 'task-7' }],
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.list',
      argumentsValue: {
        agentType: 'nim',
      },
    }),
    {
      count: 1,
      limit: 100,
      threads: [
        {
          threadId: 'thread-2',
          agentType: 'nim',
          runtimeStatus: 'needs-input',
        },
      ],
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.create',
      argumentsValue: {
        projectId: 'project-1',
        title: 'new thread',
        agentType: 'nim',
      },
    }),
    {
      threadId: 'thread-new',
      projectId: 'project-1',
      title: 'new thread',
      agentType: 'nim',
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.update',
      argumentsValue: {
        threadId: 'thread-1',
        title: 'renamed',
      },
    }),
    {
      threadId: 'thread-1',
      title: 'renamed',
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.archive',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      threadId: 'thread-1',
      archived: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.status',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      threadId: 'thread-1',
      status: {
        sessionId: 'thread-1',
        status: 'running',
      },
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.snapshot',
      argumentsValue: {
        threadId: 'thread-1',
        tailLines: 20,
      },
    }),
    {
      threadId: 'thread-1',
      tailLines: 20,
      snapshot: {
        sessionId: 'thread-1',
        tailLines: 20,
      },
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.respond',
      argumentsValue: {
        threadId: 'thread-1',
        message: 'hello via alias',
      },
    }),
    {
      responded: true,
      sentBytes: 24,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.respond',
      argumentsValue: {
        threadId: 'thread-1',
        text: 'hello',
      },
    }),
    {
      responded: true,
      sentBytes: 14,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.interrupt',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      interrupted: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.claim',
      argumentsValue: {
        threadId: 'thread-1',
        controllerId: 'nim-controller',
        takeover: true,
      },
    }),
    {
      sessionId: 'thread-1',
      action: 'taken-over',
      controller: {
        controllerId: 'nim-controller',
      },
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.release',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      sessionId: 'thread-1',
      released: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.start',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      sessionId: 'thread-1',
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.attach',
      argumentsValue: {
        threadId: 'thread-1',
        sinceCursor: 9,
      },
    }),
    {
      latestCursor: 9,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.detach',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      detached: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.events.subscribe',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      subscribed: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.events.unsubscribe',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      subscribed: false,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.close',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      closed: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'thread.remove',
      argumentsValue: {
        threadId: 'thread-1',
      },
    }),
    {
      removed: true,
    },
  );
  assert.deepEqual(
    await bridge.invoke({
      toolName: 'session.list',
      argumentsText: '',
    }),
    {
      count: 1,
      sessions: [{ sessionId: 'session-1' }],
    },
  );
});

void test('runtime nim tool bridge rejects invalid task.list limits and unknown tools', async () => {
  const bridge = createBridge();

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'task.list',
        argumentsText: 'abc',
      }),
    {
      message: 'invalid limit: abc',
    },
  );

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'thread.respond',
        argumentsValue: {
          threadId: 'thread-1',
        },
      }),
    {
      message: 'missing thread.respond text (expected {"threadId":"<id>","text":"<message>"})',
    },
  );

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'thread.create',
        argumentsValue: {
          title: 'missing project',
        },
      }),
    {
      message: 'missing thread.create projectId',
    },
  );

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'thread.create',
        argumentsValue: {
          projectId: 'project-1',
          title: 'missing type',
        },
      }),
    {
      message:
        'missing thread.create agentType (expected one of codex|claude|cursor|terminal|shell|critique|nim)',
    },
  );

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'unknown.tool',
        argumentsText: '',
      }),
    {
      message: 'unsupported nim tool: unknown.tool',
    },
  );
});
