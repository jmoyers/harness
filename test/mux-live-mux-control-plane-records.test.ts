import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseConversationRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
  parseSessionControllerRecord,
  parseTaskRecord,
  parseTaskStatus
} from '../src/mux/live-mux/control-plane-records.ts';

void test('parseDirectoryRecord validates shape', () => {
  assert.equal(parseDirectoryRecord(null), null);
  assert.equal(
    parseDirectoryRecord({
      directoryId: 'd1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      path: '/tmp/work',
      createdAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null
    })?.directoryId,
    'd1'
  );
  assert.equal(
    parseDirectoryRecord({
      directoryId: 'd1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      path: '/tmp/work',
      createdAt: 12
    }),
    null
  );

  const validBase = {
    directoryId: 'd1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    path: '/tmp/work',
    createdAt: null,
    archivedAt: null
  };
  const invalidCases: Array<[keyof typeof validBase, unknown]> = [
    ['directoryId', 1],
    ['tenantId', 1],
    ['userId', 1],
    ['workspaceId', 1],
    ['path', 1],
    ['createdAt', 1],
    ['archivedAt', 1]
  ];
  for (const [key, value] of invalidCases) {
    assert.equal(parseDirectoryRecord({ ...validBase, [key]: value }), null);
  }
});

void test('parseConversationRecord validates runtime status and adapter state', () => {
  assert.equal(parseConversationRecord('invalid'), null);

  const parsed = parseConversationRecord({
    conversationId: 'c1',
    directoryId: 'd1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    title: 'hello',
    agentType: 'codex',
    adapterState: { foo: 'bar' },
    runtimeStatus: 'running',
    runtimeLive: true
  });
  assert.equal(parsed?.runtimeStatus, 'running');

  assert.equal(
    parseConversationRecord({
      conversationId: 'c1',
      directoryId: 'd1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      title: 'hello',
      agentType: 'codex',
      adapterState: [],
      runtimeStatus: 'running',
      runtimeLive: true
    }),
    null
  );

  assert.equal(
    parseConversationRecord({
      conversationId: 'c1',
      directoryId: 'd1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      title: 'hello',
      agentType: 'codex',
      adapterState: { foo: 'bar' },
      runtimeStatus: 'paused',
      runtimeLive: true
    }),
    null
  );

  const validBase = {
    conversationId: 'c1',
    directoryId: 'd1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    title: 'hello',
    agentType: 'codex',
    adapterState: { foo: 'bar' },
    runtimeStatus: 'running',
    runtimeLive: true
  } as const;
  const invalidCases: Array<[keyof typeof validBase, unknown]> = [
    ['conversationId', 1],
    ['directoryId', 1],
    ['tenantId', 1],
    ['userId', 1],
    ['workspaceId', 1],
    ['title', 1],
    ['agentType', 1],
    ['adapterState', []],
    ['runtimeLive', 'yes']
  ];
  for (const [key, value] of invalidCases) {
    assert.equal(parseConversationRecord({ ...validBase, [key]: value }), null);
  }

  assert.equal(
    parseConversationRecord({
      ...validBase,
      runtimeStatus: 'needs-input'
    })?.runtimeStatus,
    'needs-input'
  );
  assert.equal(
    parseConversationRecord({
      ...validBase,
      runtimeStatus: 'completed'
    })?.runtimeStatus,
    'completed'
  );
  assert.equal(
    parseConversationRecord({
      ...validBase,
      runtimeStatus: 'exited'
    })?.runtimeStatus,
    'exited'
  );
});

void test('parseRepositoryRecord validates metadata and timestamps', () => {
  assert.equal(parseRepositoryRecord('invalid'), null);

  const parsed = parseRepositoryRecord({
    repositoryId: 'r1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness',
    defaultBranch: 'main',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    archivedAt: undefined
  });
  assert.equal(parsed?.name, 'harness');

  assert.equal(
    parseRepositoryRecord({
      repositoryId: 'r1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      name: 'harness',
      remoteUrl: 'https://github.com/acme/harness',
      defaultBranch: 'main',
      metadata: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    }),
    null
  );

  const validBase = {
    repositoryId: 'r1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    name: 'harness',
    remoteUrl: 'https://github.com/acme/harness',
    defaultBranch: 'main',
    metadata: {},
    createdAt: null,
    archivedAt: null
  };
  const invalidCases: Array<[keyof typeof validBase, unknown]> = [
    ['repositoryId', 1],
    ['tenantId', 1],
    ['userId', 1],
    ['workspaceId', 1],
    ['name', 1],
    ['remoteUrl', 1],
    ['defaultBranch', 1],
    ['metadata', []],
    ['createdAt', 1],
    ['archivedAt', 1]
  ];
  for (const [key, value] of invalidCases) {
    assert.equal(parseRepositoryRecord({ ...validBase, [key]: value }), null);
  }
});

void test('parseTaskStatus maps legacy queued to ready and rejects unknown', () => {
  assert.equal(parseTaskStatus('queued'), 'ready');
  assert.equal(parseTaskStatus('draft'), 'draft');
  assert.equal(parseTaskStatus('ready'), 'ready');
  assert.equal(parseTaskStatus('in-progress'), 'in-progress');
  assert.equal(parseTaskStatus('completed'), 'completed');
  assert.equal(parseTaskStatus('other'), null);
});

void test('parseTaskRecord validates optional fields and required scalar types', () => {
  assert.equal(parseTaskRecord('invalid'), null);

  const parsed = parseTaskRecord({
    taskId: 'task-1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    repositoryId: null,
    title: 'Fix thing',
    description: 'Details',
    status: 'ready',
    orderIndex: 3,
    claimedByControllerId: 'controller-1',
    claimedByDirectoryId: undefined,
    branchName: null,
    baseBranch: 'main',
    claimedAt: null,
    completedAt: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(parsed?.taskId, 'task-1');
  assert.equal(parsed?.repositoryId, null);
  assert.equal(parsed?.claimedByDirectoryId, null);

  assert.equal(
    parseTaskRecord({
      taskId: 'task-1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      repositoryId: false,
      title: 'Fix thing',
      description: 'Details',
      status: 'ready',
      orderIndex: 3,
      claimedByControllerId: null,
      claimedByDirectoryId: null,
      branchName: null,
      baseBranch: null,
      claimedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }),
    null
  );

  assert.equal(
    parseTaskRecord({
      taskId: 'task-1',
      tenantId: 't1',
      userId: 'u1',
      workspaceId: 'w1',
      repositoryId: null,
      title: 'Fix thing',
      description: 'Details',
      status: 'bogus',
      orderIndex: 3,
      claimedByControllerId: null,
      claimedByDirectoryId: null,
      branchName: null,
      baseBranch: null,
      claimedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }),
    null
  );

  const validBase = {
    taskId: 'task-1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId: 'w1',
    repositoryId: null,
    title: 'Fix thing',
    description: 'Details',
    status: 'ready',
    orderIndex: 3,
    claimedByControllerId: null,
    claimedByDirectoryId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  };
  const invalidCases: Array<[keyof typeof validBase, unknown]> = [
    ['taskId', 1],
    ['tenantId', 1],
    ['userId', 1],
    ['workspaceId', 1],
    ['repositoryId', false],
    ['title', 1],
    ['description', 1],
    ['status', 'bogus'],
    ['orderIndex', 'x'],
    ['claimedByControllerId', 1],
    ['claimedByDirectoryId', 1],
    ['branchName', 1],
    ['baseBranch', 1],
    ['claimedAt', 1],
    ['completedAt', 1],
    ['createdAt', 1],
    ['updatedAt', 1]
  ];
  for (const [key, value] of invalidCases) {
    assert.equal(parseTaskRecord({ ...validBase, [key]: value }), null);
  }
});

void test('parseSessionControllerRecord validates controller payloads', () => {
  assert.equal(parseSessionControllerRecord('invalid'), null);

  assert.deepEqual(
    parseSessionControllerRecord({
      controllerId: 'id-1',
      controllerType: 'human',
      controllerLabel: null,
      claimedAt: '2026-01-01T00:00:00.000Z'
    }),
    {
      controllerId: 'id-1',
      controllerType: 'human',
      controllerLabel: null,
      claimedAt: '2026-01-01T00:00:00.000Z'
    }
  );

  assert.equal(
    parseSessionControllerRecord({
      controllerId: 'id-2',
      controllerType: 'automation',
      controllerLabel: 'auto',
      claimedAt: '2026-01-01T00:00:00.000Z'
    })?.controllerType,
    'automation'
  );

  assert.equal(
    parseSessionControllerRecord({
      controllerId: 'id-1',
      controllerType: 'bad-type',
      controllerLabel: null,
      claimedAt: '2026-01-01T00:00:00.000Z'
    }),
    null
  );

  assert.equal(
    parseSessionControllerRecord({
      controllerId: 'id-1',
      controllerType: 'agent',
      controllerLabel: 7,
      claimedAt: '2026-01-01T00:00:00.000Z'
    }),
    null
  );
});
