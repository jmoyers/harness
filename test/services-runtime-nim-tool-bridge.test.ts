import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeNimToolBridge } from '../src/services/runtime-nim-tool-bridge.ts';

void test('runtime nim tool bridge registers read-only tools and policy', () => {
  const registeredTools: string[] = [];
  let policyHash = '';
  const bridge = new RuntimeNimToolBridge({
    listDirectories: async () => [],
    listRepositories: async () => [],
    listTasks: async () => [],
    listSessions: async () => [],
  });

  bridge.registerWithRuntime({
    registerTools: (tools) => {
      for (const tool of tools) {
        registeredTools.push(tool.name);
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
    'session.list',
  ]);
  assert.equal(policyHash, 'nim-control-plane-read-v1');
});

void test('runtime nim tool bridge invokes read-only control-plane adapters', async () => {
  const bridge = new RuntimeNimToolBridge({
    listDirectories: async () => [{ directoryId: 'dir-1' }],
    listRepositories: async () => [{ repositoryId: 'repo-1' }],
    listTasks: async (limit) => [{ taskId: `task-${String(limit)}` }],
    listSessions: async () => [{ sessionId: 'session-1' }],
  });

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
  const bridge = new RuntimeNimToolBridge({
    listDirectories: async () => [],
    listRepositories: async () => [],
    listTasks: async () => [],
    listSessions: async () => [],
  });

  await assert.rejects(
    async () =>
      await bridge.invoke({
        toolName: 'task.list',
        argumentsText: 'abc',
      }),
    {
      message: 'invalid task.list limit: abc',
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
