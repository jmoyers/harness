import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DEFAULT_STREAM_COMMAND_PARSERS,
  parseStreamCommand,
  type StreamCommandParserRegistry,
} from '../src/control-plane/stream-command-parser.ts';

void test('parseStreamCommand parses known commands with default registry', () => {
  const parsed = parseStreamCommand({
    type: 'directory.upsert',
    directoryId: 'directory-1',
    path: '/tmp/project',
  });
  assert.deepEqual(parsed, {
    type: 'directory.upsert',
    directoryId: 'directory-1',
    path: '/tmp/project',
  });
  assert.deepEqual(
    parseStreamCommand({
      type: 'directory.git-status',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      directoryId: 'directory-1',
    }),
    {
      type: 'directory.git-status',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      directoryId: 'directory-1',
    },
  );
});

void test('parseStreamCommand parses repository and task commands', () => {
  assert.deepEqual(
    parseStreamCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
      metadata: {
        owner: 'acme',
      },
    }),
    {
      type: 'repository.upsert',
      repositoryId: 'repository-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
      metadata: {
        owner: 'acme',
      },
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'repository.get',
      repositoryId: 'repository-1',
    }),
    {
      type: 'repository.get',
      repositoryId: 'repository-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'repository.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      includeArchived: true,
      limit: 25,
    }),
    {
      type: 'repository.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      includeArchived: true,
      limit: 25,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 'Harness 2',
      remoteUrl: 'https://github.com/acme/harness-2.git',
      defaultBranch: 'develop',
      metadata: {
        archivedReason: null,
      },
    }),
    {
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 'Harness 2',
      remoteUrl: 'https://github.com/acme/harness-2.git',
      defaultBranch: 'develop',
      metadata: {
        archivedReason: null,
      },
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'repository.archive',
      repositoryId: 'repository-1',
    }),
    {
      type: 'repository.archive',
      repositoryId: 'repository-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.create',
      taskId: 'task-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      title: 'Implement task API',
      description: 'Expose task CRUD via stream commands',
      linear: {
        issueId: 'linear-1',
        identifier: 'ENG-7',
        url: 'https://linear.app/acme/issue/ENG-7',
        teamId: 'team-eng',
        projectId: 'project-1',
        projectMilestoneId: 'milestone-1',
        cycleId: 'cycle-1',
        stateId: 'state-1',
        assigneeId: 'user-1',
        priority: 2,
        estimate: 3,
        dueDate: '2026-03-01',
        labelIds: ['api', 'backend'],
      },
    }),
    {
      type: 'task.create',
      taskId: 'task-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      title: 'Implement task API',
      description: 'Expose task CRUD via stream commands',
      linear: {
        issueId: 'linear-1',
        identifier: 'ENG-7',
        url: 'https://linear.app/acme/issue/ENG-7',
        teamId: 'team-eng',
        projectId: 'project-1',
        projectMilestoneId: 'milestone-1',
        cycleId: 'cycle-1',
        stateId: 'state-1',
        assigneeId: 'user-1',
        priority: 2,
        estimate: 3,
        dueDate: '2026-03-01',
        labelIds: ['api', 'backend'],
      },
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.get',
      taskId: 'task-1',
    }),
    {
      type: 'task.get',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.create',
      title: 'Nullable linear fields',
      linear: {
        url: null,
        projectMilestoneId: null,
        priority: null,
        estimate: null,
        labelIds: null,
      },
    }),
    {
      type: 'task.create',
      title: 'Nullable linear fields',
      linear: {
        url: null,
        projectMilestoneId: null,
        priority: null,
        estimate: null,
        labelIds: null,
      },
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      status: 'queued',
      limit: 50,
    }),
    {
      type: 'task.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      status: 'ready',
      limit: 50,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      title: 'Implement task API v2',
      description: 'allow null repository',
      repositoryId: null,
      linear: {
        priority: 1,
        labelIds: ['migration'],
      },
    }),
    {
      type: 'task.update',
      taskId: 'task-1',
      title: 'Implement task API v2',
      description: 'allow null repository',
      repositoryId: null,
      linear: {
        priority: 1,
        labelIds: ['migration'],
      },
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-2',
      title: 'No repository update',
      linear: null,
    }),
    {
      type: 'task.update',
      taskId: 'task-2',
      title: 'No repository update',
      linear: null,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.delete',
      taskId: 'task-1',
    }),
    {
      type: 'task.delete',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      directoryId: 'directory-1',
      branchName: 'feature/task-api',
      baseBranch: 'main',
    }),
    {
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      directoryId: 'directory-1',
      branchName: 'feature/task-api',
      baseBranch: 'main',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.complete',
      taskId: 'task-1',
    }),
    {
      type: 'task.complete',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.queue',
      taskId: 'task-1',
    }),
    {
      type: 'task.queue',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.ready',
      taskId: 'task-1',
    }),
    {
      type: 'task.ready',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.draft',
      taskId: 'task-1',
    }),
    {
      type: 'task.draft',
      taskId: 'task-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.reorder',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      orderedTaskIds: ['task-2', 'task-1'],
    }),
    {
      type: 'task.reorder',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      orderedTaskIds: ['task-2', 'task-1'],
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      taskId: 'task-1',
      includeOutput: false,
      afterCursor: 0,
    }),
    {
      type: 'stream.subscribe',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      taskId: 'task-1',
      includeOutput: false,
      afterCursor: 0,
    },
  );
});

void test('parseStreamCommand rejects unknown or malformed command shapes', () => {
  assert.equal(parseStreamCommand(null), null);
  assert.equal(
    parseStreamCommand({
      type: 'missing.command',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'directory.list',
      limit: 0,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'directory.git-status',
      directoryId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'conversation.create',
      directoryId: 'directory-1',
      title: 'title',
      agentType: 'codex',
      conversationId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'session.release',
      sessionId: 'session-1',
      reason: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'pty.start',
      args: [],
      initialCols: 120,
      initialRows: 40,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'pty.attach',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 42,
      remoteUrl: 'https://github.com/acme/harness.git',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      tenantId: 123,
      metadata: [],
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.get',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      name: 'missing-id',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 123,
      metadata: [],
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 'Harness',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      tenantId: 5,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 5,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.get',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.list',
      includeArchived: 'yes',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      name: 'missing repository id',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      metadata: [],
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      name: 'Harness 2',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 2,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.archive',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 123,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 'Missing scope',
      tenantId: 123,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      tenantId: 'tenant-1',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 'bad linear',
      linear: {
        priority: 8,
      },
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 'bad linear number shape',
      linear: {
        priority: 1.5,
      },
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 'bad linear string field shape',
      linear: {
        teamId: 7,
      },
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      title: 'bad linear labels',
      linear: {
        labelIds: ['ok', 7],
      },
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.get',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.list',
      status: 'invalid',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.list',
      limit: 0,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      title: 'missing task id',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      title: 5,
    }),
    null,
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      title: 'without repository change',
    }),
    {
      type: 'task.update',
      taskId: 'task-1',
      title: 'without repository change',
    },
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      repositoryId: 5,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      linear: [],
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      linear: {
        issueId: 7,
      },
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.delete',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 99,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      directoryId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      branchName: 99,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.complete',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.queue',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.ready',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.draft',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.reorder',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      orderedTaskIds: 'task-1',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'stream.subscribe',
      repositoryId: 1,
    }),
    null,
  );
});

void test('parseStreamCommand covers repository and task guard branches for missing ids and optional fields', () => {
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      remoteUrl: 'https://github.com/acme/harness.git',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.upsert',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      workspaceId: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.get',
      repositoryId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      remoteUrl: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.create',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.get',
      taskId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 1,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      description: 7,
    }),
    null,
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
    }),
    {
      type: 'task.update',
      taskId: 'task-1',
    },
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.delete',
      taskId: 2,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      branchName: 5,
    }),
    null,
  );
});

void test('parseStreamCommand supports injected parser registry overrides', () => {
  const calls: Array<Record<string, unknown>> = [];
  const parsers: StreamCommandParserRegistry = {
    ...DEFAULT_STREAM_COMMAND_PARSERS,
    'custom.test': (record) => {
      calls.push(record);
      return {
        type: 'attention.list',
      };
    },
  };

  const parsed = parseStreamCommand(
    {
      type: 'custom.test',
      marker: 'ok',
    },
    parsers,
  );

  assert.deepEqual(parsed, {
    type: 'attention.list',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.['marker'], 'ok');
});
