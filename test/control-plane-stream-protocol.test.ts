import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  parseServerEnvelope,
} from '../src/control-plane/stream-protocol.ts';
import { statusModelFor } from './support/status-model.ts';

void test('stream protocol encodes envelopes and consumes newline-delimited json', () => {
  const encoded = encodeStreamEnvelope({
    kind: 'command.accepted',
    commandId: 'command-1',
  });
  assert.equal(encoded.endsWith('\n'), true);

  const consumed = consumeJsonLines(
    `${encoded}{"oops"\n\n{"kind":"pty.exit","sessionId":"s1","exit":{"code":0,"signal":null}}\npartial`,
  );
  assert.equal(consumed.messages.length, 2);
  assert.equal(consumed.remainder, 'partial');
});

void test('parseClientEnvelope accepts valid command and stream envelopes', () => {
  const validClientEnvelopes: unknown[] = [
    {
      kind: 'auth',
      token: 'token-local',
    },
    {
      kind: 'command',
      commandId: 'c1',
      command: {
        type: 'session.list',
      },
    },
    {
      kind: 'command',
      commandId: 'c0a',
      command: {
        type: 'directory.upsert',
        directoryId: 'directory-1',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        path: '/tmp/project',
      },
    },
    {
      kind: 'command',
      commandId: 'c0b',
      command: {
        type: 'directory.list',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        includeArchived: true,
        limit: 10,
      },
    },
    {
      kind: 'command',
      commandId: 'c0ba',
      command: {
        type: 'directory.archive',
        directoryId: 'directory-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0c',
      command: {
        type: 'conversation.create',
        conversationId: 'conversation-1',
        directoryId: 'directory-1',
        title: 'untitled task 1',
        agentType: 'codex',
        adapterState: {
          codex: {
            resumeSessionId: 'thread-123',
          },
        },
      },
    },
    {
      kind: 'command',
      commandId: 'c0d',
      command: {
        type: 'conversation.list',
        directoryId: 'directory-1',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        includeArchived: false,
        limit: 20,
      },
    },
    {
      kind: 'command',
      commandId: 'c0e',
      command: {
        type: 'conversation.archive',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0e1',
      command: {
        type: 'conversation.update',
        conversationId: 'conversation-1',
        title: 'renamed',
      },
    },
    {
      kind: 'command',
      commandId: 'c0e1a',
      command: {
        type: 'conversation.title.refresh',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0ea',
      command: {
        type: 'conversation.delete',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0eb',
      command: {
        type: 'repository.upsert',
        repositoryId: 'repository-1',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        name: 'harness',
        remoteUrl: 'https://github.com/acme/harness.git',
        defaultBranch: 'main',
        metadata: {
          owner: 'acme',
        },
      },
    },
    {
      kind: 'command',
      commandId: 'c0ec',
      command: {
        type: 'repository.get',
        repositoryId: 'repository-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0ed',
      command: {
        type: 'repository.list',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        includeArchived: true,
        limit: 20,
      },
    },
    {
      kind: 'command',
      commandId: 'c0ee',
      command: {
        type: 'repository.update',
        repositoryId: 'repository-1',
        name: 'harness-2',
        remoteUrl: 'https://github.com/acme/harness-2.git',
        defaultBranch: 'develop',
        metadata: {
          owner: 'acme',
          tier: 'core',
        },
      },
    },
    {
      kind: 'command',
      commandId: 'c0ef',
      command: {
        type: 'repository.archive',
        repositoryId: 'repository-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0eg',
      command: {
        type: 'task.create',
        taskId: 'task-1',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        repositoryId: 'repository-1',
        title: 'Implement task queue',
        description: 'Build CRUD and claim/reorder semantics',
      },
    },
    {
      kind: 'command',
      commandId: 'c0eh',
      command: {
        type: 'task.get',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0ei',
      command: {
        type: 'task.list',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        repositoryId: 'repository-1',
        status: 'ready',
        limit: 20,
      },
    },
    {
      kind: 'command',
      commandId: 'c0ej',
      command: {
        type: 'task.update',
        taskId: 'task-1',
        title: 'Implement queue API',
        description: 'Allow reassignment',
        repositoryId: null,
      },
    },
    {
      kind: 'command',
      commandId: 'c0ek',
      command: {
        type: 'task.delete',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0el',
      command: {
        type: 'task.claim',
        taskId: 'task-1',
        controllerId: 'agent-1',
        directoryId: 'directory-1',
        branchName: 'feature/task-queue',
        baseBranch: 'main',
      },
    },
    {
      kind: 'command',
      commandId: 'c0em',
      command: {
        type: 'task.complete',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0en',
      command: {
        type: 'task.queue',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0eo',
      command: {
        type: 'task.ready',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0ep',
      command: {
        type: 'task.draft',
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c0eq',
      command: {
        type: 'task.reorder',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        orderedTaskIds: ['task-2', 'task-1'],
      },
    },
    {
      kind: 'command',
      commandId: 'c0f',
      command: {
        type: 'stream.subscribe',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        repositoryId: 'repository-1',
        taskId: 'task-1',
        directoryId: 'directory-1',
        conversationId: 'conversation-1',
        includeOutput: true,
        afterCursor: 5,
      },
    },
    {
      kind: 'command',
      commandId: 'c0g',
      command: {
        type: 'stream.unsubscribe',
        subscriptionId: 'subscription-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c1x',
      command: {
        type: 'session.list',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        worktreeId: 'worktree-local',
        status: 'needs-input',
        live: true,
        sort: 'attention-first',
        limit: 5,
      },
    },
    {
      kind: 'command',
      commandId: 'c1a',
      command: {
        type: 'attention.list',
      },
    },
    {
      kind: 'command',
      commandId: 'c1aa',
      command: {
        type: 'agent.tools.status',
        agentTypes: ['codex', 'critique'],
      },
    },
    {
      kind: 'command',
      commandId: 'c1b',
      command: {
        type: 'session.status',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c1c',
      command: {
        type: 'session.snapshot',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c1c1',
      command: {
        type: 'session.snapshot',
        sessionId: 's1',
        tailLines: 25,
      },
    },
    {
      kind: 'command',
      commandId: 'c1ca',
      command: {
        type: 'session.respond',
        sessionId: 's1',
        text: 'approve',
      },
    },
    {
      kind: 'command',
      commandId: 'c1caa',
      command: {
        type: 'session.claim',
        sessionId: 's1',
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: 'agent one',
        reason: 'claim test',
        takeover: true,
      },
    },
    {
      kind: 'command',
      commandId: 'c1caa2',
      command: {
        type: 'session.claim',
        sessionId: 's1',
        controllerId: 'automation-1',
        controllerType: 'automation',
        reason: 'automation claim',
      },
    },
    {
      kind: 'command',
      commandId: 'c1cab',
      command: {
        type: 'session.release',
        sessionId: 's1',
        reason: 'release test',
      },
    },
    {
      kind: 'command',
      commandId: 'c1cb',
      command: {
        type: 'session.interrupt',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c1cc',
      command: {
        type: 'session.remove',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c1d',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: ['--help'],
        env: {
          TERM: 'xterm-256color',
        },
        cwd: '/tmp/workspace',
        initialCols: 120,
        initialRows: 40,
        terminalForegroundHex: 'd0d7de',
        terminalBackgroundHex: '0f1419',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        worktreeId: 'worktree-local',
      },
    },
    {
      kind: 'command',
      commandId: 'c2a',
      command: {
        type: 'pty.attach',
        sessionId: 's1',
        sinceCursor: 5,
      },
    },
    {
      kind: 'command',
      commandId: 'c3a',
      command: {
        type: 'pty.detach',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c4a',
      command: {
        type: 'pty.subscribe-events',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c5a',
      command: {
        type: 'pty.unsubscribe-events',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c6a',
      command: {
        type: 'pty.close',
        sessionId: 's1',
      },
    },
    {
      kind: 'pty.input',
      sessionId: 's1',
      dataBase64: Buffer.from('hello', 'utf8').toString('base64'),
    },
    {
      kind: 'pty.resize',
      sessionId: 's1',
      cols: 100,
      rows: 35,
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'interrupt',
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'eof',
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'terminate',
    },
  ];

  for (const value of validClientEnvelopes) {
    const parsed = parseClientEnvelope(value);
    assert.notEqual(parsed, null);
  }
});

void test('parseClientEnvelope rejects malformed envelopes', () => {
  const invalidValues: unknown[] = [
    null,
    'text',
    {},
    {
      kind: 'command',
      commandId: 1,
      command: {
        type: 'pty.close',
        sessionId: 's1',
      },
    },
    {
      kind: 'auth',
    },
    {
      kind: 'command',
      commandId: 'c1',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: ['ok', 1],
        initialCols: 80,
        initialRows: 24,
      },
    },
    {
      kind: 'command',
      commandId: 'c2',
      command: {
        type: 'session.list',
        status: 'bad-status',
      },
    },
    {
      kind: 'command',
      commandId: 'c2snapshot',
      command: {
        type: 'session.snapshot',
        sessionId: 's1',
        tailLines: 0,
      },
    },
    {
      kind: 'command',
      commandId: 'c2snapshotb',
      command: {
        type: 'session.snapshot',
        sessionId: 's1',
        tailLines: '10',
      },
    },
    {
      kind: 'command',
      commandId: 'c2directory',
      command: {
        type: 'directory.upsert',
      },
    },
    {
      kind: 'command',
      commandId: 'c2directoryb',
      command: {
        type: 'directory.upsert',
        path: 3,
      },
    },
    {
      kind: 'command',
      commandId: 'c2directoryc',
      command: {
        type: 'directory.upsert',
        path: '/tmp/project',
        tenantId: 3,
      },
    },
    {
      kind: 'command',
      commandId: 'c2directoryd',
      command: {
        type: 'directory.list',
        includeArchived: 'yes',
      },
    },
    {
      kind: 'command',
      commandId: 'c2directorye',
      command: {
        type: 'directory.list',
        limit: 0,
      },
    },
    {
      kind: 'command',
      commandId: 'c2directoryf',
      command: {
        type: 'directory.archive',
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversation',
      command: {
        type: 'conversation.create',
        directoryId: 'directory-1',
        title: 'title',
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversationb',
      command: {
        type: 'conversation.create',
        directoryId: 'directory-1',
        title: 'title',
        agentType: 9,
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversationc',
      command: {
        type: 'conversation.list',
        limit: 0,
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversationd',
      command: {
        type: 'conversation.archive',
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversationd1',
      command: {
        type: 'conversation.update',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversatione',
      command: {
        type: 'conversation.delete',
      },
    },
    {
      kind: 'command',
      commandId: 'c2conversationf',
      command: {
        type: 'conversation.create',
        directoryId: 'directory-1',
        title: 'title',
        agentType: 'codex',
        adapterState: [],
      },
    },
    {
      kind: 'command',
      commandId: 'c2repository',
      command: {
        type: 'repository.upsert',
        name: 'harness',
        remoteUrl: 'https://github.com/acme/harness.git',
        metadata: [],
      },
    },
    {
      kind: 'command',
      commandId: 'c2repositoryb',
      command: {
        type: 'repository.list',
        includeArchived: 'true',
      },
    },
    {
      kind: 'command',
      commandId: 'c2repositoryc',
      command: {
        type: 'repository.update',
        repositoryId: 'repository-1',
        metadata: [],
      },
    },
    {
      kind: 'command',
      commandId: 'c2repositoryd',
      command: {
        type: 'repository.archive',
      },
    },
    {
      kind: 'command',
      commandId: 'c2task',
      command: {
        type: 'task.create',
        title: 'a',
        tenantId: 4,
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskb',
      command: {
        type: 'task.list',
        status: 'bad-status',
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskc',
      command: {
        type: 'task.list',
        limit: 0,
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskd',
      command: {
        type: 'task.update',
        taskId: 'task-1',
        repositoryId: 7,
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskd2',
      command: {
        type: 'task.update',
        taskId: 'task-1',
        projectId: 7,
      },
    },
    {
      kind: 'command',
      commandId: 'c2taske',
      command: {
        type: 'task.claim',
        taskId: 'task-1',
        controllerId: 7,
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskf',
      command: {
        type: 'task.complete',
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskg',
      command: {
        type: 'task.queue',
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskh',
      command: {
        type: 'task.ready',
      },
    },
    {
      kind: 'command',
      commandId: 'c2taski',
      command: {
        type: 'task.draft',
      },
    },
    {
      kind: 'command',
      commandId: 'c2taskj',
      command: {
        type: 'task.reorder',
        tenantId: 'tenant-local',
        userId: 'user-local',
        workspaceId: 'workspace-local',
        orderedTaskIds: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2stream',
      command: {
        type: 'stream.subscribe',
        includeOutput: 'yes',
        repositoryId: 'repository-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2streamb',
      command: {
        type: 'stream.subscribe',
        afterCursor: -1,
        taskId: 'task-1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2streamc',
      command: {
        type: 'stream.unsubscribe',
      },
    },
    {
      kind: 'command',
      commandId: 'c2b',
      command: {
        type: 'session.list',
        live: 'true',
      },
    },
    {
      kind: 'command',
      commandId: 'c2ba',
      command: {
        type: 'session.list',
        tenantId: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2bb',
      command: {
        type: 'session.list',
        userId: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2bc',
      command: {
        type: 'session.list',
        workspaceId: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2bd',
      command: {
        type: 'session.list',
        worktreeId: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2be',
      command: {
        type: 'session.list',
        status: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2c',
      command: {
        type: 'session.list',
        sort: 'weird',
      },
    },
    {
      kind: 'command',
      commandId: 'c2ca',
      command: {
        type: 'session.list',
        sort: 1,
      },
    },
    {
      kind: 'command',
      commandId: 'c2d',
      command: {
        type: 'session.list',
        limit: 0,
      },
    },
    {
      kind: 'command',
      commandId: 'c2da',
      command: {
        type: 'session.list',
        limit: '1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2e',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        env: {
          TERM: 1,
        },
        initialCols: 80,
        initialRows: 24,
      },
    },
    {
      kind: 'command',
      commandId: 'c2f',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        initialCols: 80,
        initialRows: 24,
        cwd: 123,
        tenantId: 'tenant-a',
      },
    },
    {
      kind: 'command',
      commandId: 'c2f0',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        initialCols: 80,
        initialRows: 24,
        tenantId: 123,
      },
    },
    {
      kind: 'command',
      commandId: 'c2g',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        initialCols: 80,
        initialRows: 24,
        userId: 123,
      },
    },
    {
      kind: 'command',
      commandId: 'c2h',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        initialCols: 80,
        initialRows: 24,
        workspaceId: 123,
      },
    },
    {
      kind: 'command',
      commandId: 'c2i',
      command: {
        type: 'pty.start',
        sessionId: 's1',
        args: [],
        initialCols: 80,
        initialRows: 24,
        worktreeId: 123,
      },
    },
    {
      kind: 'command',
      commandId: 'c2',
      command: {
        type: 'session.status',
      },
    },
    {
      kind: 'command',
      commandId: 'c2a',
      command: {
        type: 'session.respond',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c2a-claim',
      command: {
        type: 'session.claim',
        sessionId: 's1',
        controllerId: 'agent-1',
        controllerType: 'invalid',
      },
    },
    {
      kind: 'command',
      commandId: 'c2a-claimb',
      command: {
        type: 'session.claim',
        sessionId: 's1',
        controllerId: 'agent-1',
        controllerType: 'agent',
        takeover: 'yes',
      },
    },
    {
      kind: 'command',
      commandId: 'c2a-release',
      command: {
        type: 'session.release',
      },
    },
    {
      kind: 'command',
      commandId: 'c2b',
      command: {
        type: 'session.respond',
        text: 'x',
      },
    },
    {
      kind: 'command',
      commandId: 'c3',
      command: {
        type: 'pty.attach',
        sessionId: 's1',
        sinceCursor: 'x',
      },
    },
    {
      kind: 'command',
      commandId: 'c4',
      command: {
        type: 'unknown',
        sessionId: 's1',
      },
    },
    {
      kind: 'command',
      commandId: 'c4b',
      command: {
        type: 'pty.close',
      },
    },
    {
      kind: 'pty.input',
      sessionId: 's1',
    },
    {
      kind: 'pty.signal',
      signal: 'interrupt',
    },
    {
      kind: 'pty.resize',
      sessionId: 's1',
      cols: '100',
      rows: 24,
    },
    {
      kind: 'pty.signal',
      sessionId: 's1',
      signal: 'boom',
    },
  ];

  for (const value of invalidValues) {
    assert.equal(parseClientEnvelope(value), null);
  }
});

void test('parseServerEnvelope accepts valid server envelopes', () => {
  const validServerEnvelopes: unknown[] = [
    {
      kind: 'auth.ok',
    },
    {
      kind: 'auth.error',
      error: 'invalid auth token',
    },
    {
      kind: 'command.accepted',
      commandId: 'c1',
    },
    {
      kind: 'command.completed',
      commandId: 'c1',
      result: {
        ok: true,
      },
    },
    {
      kind: 'command.failed',
      commandId: 'c1',
      error: 'bad',
    },
    {
      kind: 'pty.output',
      sessionId: 's1',
      cursor: 9,
      chunkBase64: Buffer.from('x', 'utf8').toString('base64'),
    },
    {
      kind: 'pty.exit',
      sessionId: 's1',
      exit: {
        code: 0,
        signal: null,
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: {
          code: null,
          signal: 'SIGTERM',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        statusModel: statusModelFor('running', {
          observedAt: new Date(0).toISOString(),
        }),
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: 'directory-1',
        conversationId: 'conversation-1',
        telemetry: {
          source: 'otlp-log',
          eventName: 'codex.api_request',
          severity: 'INFO',
          summary: 'codex.api_request (ok)',
          observedAt: new Date(0).toISOString(),
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'needs-input',
        attentionReason: 'approval',
        statusModel: statusModelFor('needs-input', {
          attentionReason: 'approval',
          observedAt: new Date(0).toISOString(),
        }),
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: 'directory-1',
        conversationId: 'conversation-1',
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.15,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        statusModel: statusModelFor('running', {
          observedAt: new Date(0).toISOString(),
        }),
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: 'directory-1',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.2,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'completed',
        attentionReason: null,
        statusModel: statusModelFor('completed', {
          observedAt: new Date(0).toISOString(),
        }),
        live: false,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.3,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'exited',
        attentionReason: null,
        statusModel: statusModelFor('exited', {
          observedAt: new Date(0).toISOString(),
        }),
        live: false,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.35,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        statusModel: statusModelFor('running', {
          observedAt: new Date(0).toISOString(),
        }),
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        controller: {
          controllerId: 'automation-1',
          controllerType: 'automation',
          controllerLabel: null,
          claimedAt: new Date(0).toISOString(),
        },
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.4,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'otlp-log',
          eventName: 'codex.sse_event',
          severity: 'INFO',
          summary: 'response.completed',
          observedAt: new Date(0).toISOString(),
          statusHint: 'completed',
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.45,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'history',
          eventName: null,
          severity: null,
          summary: 'history.entry',
          observedAt: new Date(0).toISOString(),
          statusHint: null,
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.46,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'otlp-metric',
          eventName: 'turn.e2e_duration_ms',
          severity: 'INFO',
          summary: 'turn in progress',
          observedAt: new Date(0).toISOString(),
          statusHint: 'running',
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.47,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'otlp-trace',
          eventName: 'codex.tool_decision',
          severity: 'WARN',
          summary: 'approval required',
          observedAt: new Date(0).toISOString(),
          statusHint: 'needs-input',
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 12.48,
      event: {
        type: 'session-prompt-event',
        sessionId: 's1',
        prompt: {
          text: 'add regression coverage for prompt capture',
          hash: 'abc123',
          confidence: 'high',
          captureSource: 'hook-notify',
          providerEventName: 'claude.userpromptsubmit',
          providerPayloadKeys: ['hook_event_name', 'prompt'],
          observedAt: new Date(0).toISOString(),
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 13,
      event: {
        type: 'session-output',
        sessionId: 's1',
        outputCursor: 4,
        chunkBase64: Buffer.from('x', 'utf8').toString('base64'),
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 14,
      event: {
        type: 'directory-upserted',
        directory: {
          directoryId: 'directory-1',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 14.5,
      event: {
        type: 'directory-archived',
        directoryId: 'directory-1',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 14.75,
      event: {
        type: 'directory-git-updated',
        directoryId: 'directory-1',
        summary: {
          branch: 'main',
          changedFiles: 3,
          additions: 10,
          deletions: 2,
        },
        repositorySnapshot: {
          normalizedRemoteUrl: 'https://github.com/example/harness',
          commitCount: 42,
          lastCommitAt: new Date(0).toISOString(),
          shortCommitHash: 'abc1234',
          inferredName: 'harness',
          defaultBranch: 'main',
        },
        repositoryId: 'repository-1',
        repository: {
          repositoryId: 'repository-1',
          name: 'harness',
        },
        observedAt: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 15,
      event: {
        type: 'conversation-created',
        conversation: {
          conversationId: 'conversation-1',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16,
      event: {
        type: 'conversation-archived',
        conversationId: 'conversation-1',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.25,
      event: {
        type: 'conversation-updated',
        conversation: {
          conversationId: 'conversation-1',
          title: 'renamed',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.5,
      event: {
        type: 'conversation-deleted',
        conversationId: 'conversation-1',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.6,
      event: {
        type: 'repository-upserted',
        repository: {
          repositoryId: 'repository-1',
          name: 'harness',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.7,
      event: {
        type: 'repository-updated',
        repository: {
          repositoryId: 'repository-1',
          name: 'harness-2',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.8,
      event: {
        type: 'repository-archived',
        repositoryId: 'repository-1',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.9,
      event: {
        type: 'task-created',
        task: {
          taskId: 'task-1',
          repositoryId: 'repository-1',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.91,
      event: {
        type: 'task-updated',
        task: {
          taskId: 'task-1',
          status: 'in-progress',
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.92,
      event: {
        type: 'task-deleted',
        taskId: 'task-1',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 16.93,
      event: {
        type: 'task-reordered',
        tasks: [
          {
            taskId: 'task-2',
            orderIndex: 0,
          },
          {
            taskId: 'task-1',
            orderIndex: 1,
          },
        ],
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'session-exit',
          exit: {
            code: 0,
            signal: null,
          },
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17.25,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'session-exit',
          exit: {
            code: 0,
            signal: null,
          },
        },
        ts: new Date(0).toISOString(),
        directoryId: 'directory-1',
        conversationId: 'conversation-1',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17.3,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'notify',
          record: {
            ts: new Date(0).toISOString(),
            payload: {
              type: 'agent-turn-complete',
            },
          },
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17.5,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'taken-over',
        controller: {
          controllerId: 'human-1',
          controllerType: 'human',
          controllerLabel: 'operator',
          claimedAt: new Date(0).toISOString(),
        },
        previousController: {
          controllerId: 'agent-1',
          controllerType: 'agent',
          controllerLabel: 'agent one',
          claimedAt: new Date(0).toISOString(),
        },
        reason: 'manual takeover',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17.6,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'claimed',
        controller: {
          controllerId: 'automation-1',
          controllerType: 'automation',
          controllerLabel: null,
          claimedAt: new Date(0).toISOString(),
        },
        previousController: null,
        reason: null,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 17.7,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'released',
        controller: null,
        previousController: {
          controllerId: 'agent-1',
          controllerType: 'agent',
          controllerLabel: 'agent one',
          claimedAt: new Date(0).toISOString(),
        },
        reason: 'released by user',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
  ];

  for (const value of validServerEnvelopes) {
    const parsed = parseServerEnvelope(value);
    assert.notEqual(parsed, null);
  }
});

void test('parseServerEnvelope rejects malformed session-status status model payloads', () => {
  const baseEnvelope = {
    kind: 'stream.event',
    subscriptionId: 'subscription-1',
    cursor: 1,
    event: {
      type: 'session-status',
      sessionId: 'session-1',
      status: 'running',
      attentionReason: null,
      statusModel: statusModelFor('running', {
        observedAt: '2026-01-01T00:00:00.000Z',
      }),
      live: true,
      ts: '2026-01-01T00:00:00.000Z',
      directoryId: null,
      conversationId: null,
      telemetry: null,
      controller: null,
    },
  } as const;

  assert.notEqual(parseServerEnvelope(baseEnvelope), null);
  assert.notEqual(
    parseServerEnvelope({
      ...baseEnvelope,
      event: {
        ...baseEnvelope.event,
        statusModel: null,
      },
    }),
    null,
  );
  assert.equal(
    parseServerEnvelope({
      ...baseEnvelope,
      event: {
        ...baseEnvelope.event,
        statusModel: 'bad-model',
      },
    }),
    null,
  );
  assert.equal(
    parseServerEnvelope({
      ...baseEnvelope,
      event: {
        ...baseEnvelope.event,
        statusModel: {
          ...baseEnvelope.event.statusModel,
          phaseHint: 'invalid',
        },
      },
    }),
    null,
  );
  assert.equal(
    parseServerEnvelope({
      ...baseEnvelope,
      event: {
        ...baseEnvelope.event,
        status: 'paused',
      },
    }),
    null,
  );
});
