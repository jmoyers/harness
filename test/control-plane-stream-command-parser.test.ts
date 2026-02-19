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
      body: 'Expose task CRUD via stream commands',
    }),
    {
      type: 'task.create',
      taskId: 'task-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      title: 'Implement task API',
      body: 'Expose task CRUD via stream commands',
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
      repositoryId: 'repository-1',
      body: 'Simple task',
    }),
    {
      type: 'task.create',
      repositoryId: 'repository-1',
      body: 'Simple task',
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
      type: 'task.list',
      projectId: 'directory-1',
      scopeKind: 'project',
      status: 'ready',
    }),
    {
      type: 'task.list',
      projectId: 'directory-1',
      scopeKind: 'project',
      status: 'ready',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      title: 'Implement task API v2',
      body: 'allow null repository',
      repositoryId: null,
      projectId: 'directory-1',
    }),
    {
      type: 'task.update',
      taskId: 'task-1',
      title: 'Implement task API v2',
      body: 'allow null repository',
      repositoryId: null,
      projectId: 'directory-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.pull',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      controllerId: 'agent-1',
      directoryId: 'directory-1',
      repositoryId: 'repository-1',
      branchName: 'main',
      baseBranch: 'main',
    }),
    {
      type: 'task.pull',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      controllerId: 'agent-1',
      directoryId: 'directory-1',
      repositoryId: 'repository-1',
      branchName: 'main',
      baseBranch: 'main',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'project.settings-get',
      directoryId: 'directory-1',
    }),
    {
      type: 'project.settings-get',
      directoryId: 'directory-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'project.settings-update',
      directoryId: 'directory-1',
      pinnedBranch: null,
      taskFocusMode: 'own-only',
      threadSpawnMode: 'reuse-thread',
    }),
    {
      type: 'project.settings-update',
      directoryId: 'directory-1',
      pinnedBranch: null,
      taskFocusMode: 'own-only',
      threadSpawnMode: 'reuse-thread',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'project.status',
      directoryId: 'directory-1',
    }),
    {
      type: 'project.status',
      directoryId: 'directory-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'automation.policy-get',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      scope: 'repository',
      scopeId: 'repository-1',
    }),
    {
      type: 'automation.policy-get',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      scope: 'repository',
      scopeId: 'repository-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'automation.policy-set',
      scope: 'global',
      automationEnabled: false,
      frozen: true,
    }),
    {
      type: 'automation.policy-set',
      scope: 'global',
      automationEnabled: false,
      frozen: true,
    },
  );
  assert.deepEqual(
    parseStreamCommand({ type: 'task.update', taskId: 'task-2', title: 'No changes' }),
    {
      type: 'task.update',
      taskId: 'task-2',
      title: 'No changes',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-project-null',
      projectId: null,
    }),
    {
      type: 'task.update',
      taskId: 'task-project-null',
      projectId: null,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-project-string',
      projectId: 'directory-1',
    }),
    {
      type: 'task.update',
      taskId: 'task-project-string',
      projectId: 'directory-1',
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

void test('parseStreamCommand parses github command shapes', () => {
  assert.deepEqual(
    parseStreamCommand({
      type: 'github.project-pr',
      directoryId: 'directory-1',
    }),
    {
      type: 'github.project-pr',
      directoryId: 'directory-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'github.pr-list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      directoryId: 'directory-1',
      headBranch: 'feature/github',
      state: 'open',
      limit: 50,
    }),
    {
      type: 'github.pr-list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      directoryId: 'directory-1',
      headBranch: 'feature/github',
      state: 'open',
      limit: 50,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'github.pr-create',
      directoryId: 'directory-1',
      title: 'Open github integration PR',
      body: 'Implements control-plane PR sync.',
      baseBranch: 'main',
      headBranch: 'feature/github',
      draft: true,
    }),
    {
      type: 'github.pr-create',
      directoryId: 'directory-1',
      title: 'Open github integration PR',
      body: 'Implements control-plane PR sync.',
      baseBranch: 'main',
      headBranch: 'feature/github',
      draft: true,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'github.pr-jobs-list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      prRecordId: 'pr-1',
      limit: 25,
    }),
    {
      type: 'github.pr-jobs-list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      prRecordId: 'pr-1',
      limit: 25,
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'github.repo-my-prs-url',
      repositoryId: 'repository-1',
    }),
    {
      type: 'github.repo-my-prs-url',
      repositoryId: 'repository-1',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'linear.issue.import',
      url: 'https://linear.app/acme/issue/ENG-123/fix-startup-flicker',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
    }),
    {
      type: 'linear.issue.import',
      url: 'https://linear.app/acme/issue/ENG-123/fix-startup-flicker',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
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
      type: 'conversation.title.refresh',
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
      type: 'project.settings-update',
      directoryId: 'directory-1',
      taskFocusMode: 'invalid',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-get',
      scope: 'global',
      scopeId: 'not-allowed',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-set',
      scope: 'repository',
      automationEnabled: 'yes',
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
      type: 'github.project-pr',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-list',
      state: 'invalid',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-list',
      limit: 0,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-create',
      directoryId: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-create',
      directoryId: 'directory-1',
      draft: 'yes',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-jobs-list',
      prRecordId: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.pr-jobs-list',
      limit: 0,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'github.repo-my-prs-url',
      repositoryId: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'linear.issue.import',
      url: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'linear.issue.import',
      url: 'https://linear.app/acme/issue/ENG-123/fix-startup-flicker',
      repositoryId: 7,
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
      body: 'missing scope',
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
      type: 'task.list',
      scopeKind: 'invalid-scope',
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
      projectId: 5,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'task.update',
      taskId: 'task-1',
      repositoryId: null,
      projectId: null,
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
      type: 'task.pull',
      controllerId: 'agent-1',
      baseBranch: 99,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'project.settings-get',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'project.settings-update',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'project.settings-update',
      directoryId: 'directory-1',
      pinnedBranch: 7,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'project.settings-update',
      directoryId: 'directory-1',
      threadSpawnMode: 'invalid',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'project.status',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-get',
      scope: 'invalid',
      scopeId: 'scope-1',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-get',
      scope: 'project',
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-get',
      scope: 'repository',
      scopeId: 9,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-set',
      scope: 'invalid',
      scopeId: 'scope-1',
      automationEnabled: true,
      frozen: false,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-set',
      scope: 'global',
      scopeId: 'forbidden',
      automationEnabled: true,
      frozen: false,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'automation.policy-set',
      scope: 'repository',
      automationEnabled: true,
      frozen: false,
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
      body: 7,
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

void test('parseStreamCommand parses session.snapshot tailLines and rejects malformed tailLines', () => {
  assert.deepEqual(
    parseStreamCommand({
      type: 'session.snapshot',
      sessionId: 'session-1',
      tailLines: 25,
    }),
    {
      type: 'session.snapshot',
      sessionId: 'session-1',
      tailLines: 25,
    },
  );

  assert.equal(
    parseStreamCommand({
      type: 'session.snapshot',
      sessionId: 'session-1',
      tailLines: 0,
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'session.snapshot',
      sessionId: 'session-1',
      tailLines: '10',
    }),
    null,
  );
});

void test('parseStreamCommand parses agent.tools.status and rejects malformed agentTypes', () => {
  assert.deepEqual(
    parseStreamCommand({
      type: 'agent.tools.status',
    }),
    {
      type: 'agent.tools.status',
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'agent.tools.status',
      agentTypes: ['codex', ' critique ', ''],
    }),
    {
      type: 'agent.tools.status',
      agentTypes: ['codex', 'critique'],
    },
  );
  assert.deepEqual(
    parseStreamCommand({
      type: 'agent.tools.status',
      agentTypes: [],
    }),
    {
      type: 'agent.tools.status',
    },
  );
  assert.equal(
    parseStreamCommand({
      type: 'agent.tools.status',
      agentTypes: ['codex', 1],
    }),
    null,
  );
  assert.equal(
    parseStreamCommand({
      type: 'agent.tools.status',
      agentTypes: 'codex',
    }),
    null,
  );
});
