import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { FakeLiveSession } from './control-plane-stream-server-test-helpers.ts';

void test('command module coverage: repository/task query branches and claim conflict paths are exercised', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const clientA = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const clientB = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const directoryId = 'directory-command-coverage';
    const conversationId = 'conversation-command-coverage';

    await clientA.sendCommand({
      type: 'directory.upsert',
      directoryId,
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      path: '/tmp',
    });
    await clientA.sendCommand({
      type: 'conversation.create',
      conversationId,
      directoryId,
      title: 'coverage',
      agentType: 'codex',
      adapterState: {},
    });
    await clientA.sendCommand({
      type: 'pty.start',
      sessionId: conversationId,
      args: ['resume', 'thread-command-coverage'],
      env: { TERM: 'xterm-256color' },
      initialCols: 80,
      initialRows: 24,
    });

    await clientA.sendCommand({
      type: 'session.claim',
      sessionId: conversationId,
      controllerId: 'controller-a',
      controllerType: 'human',
      controllerLabel: 'operator-a',
    });
    await assert.rejects(
      () =>
        clientB.sendCommand({
          type: 'session.claim',
          sessionId: conversationId,
          controllerId: 'controller-b',
          controllerType: 'agent',
        }),
      /session is already claimed by operator-a/,
    );

    const repositoryA = (
      await clientA.sendCommand({
        type: 'repository.upsert',
        repositoryId: 'repository-a',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        name: 'repo-a',
        remoteUrl: 'https://github.com/example/repo-a',
        defaultBranch: 'main',
      })
    )['repository'] as Record<string, unknown>;
    const repositoryB = (
      await clientA.sendCommand({
        type: 'repository.upsert',
        repositoryId: 'repository-b',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        name: 'repo-b',
        remoteUrl: 'https://github.com/example/repo-b',
        defaultBranch: 'main',
      })
    )['repository'] as Record<string, unknown>;
    const repositoryAId = repositoryA['repositoryId'] as string;
    const repositoryBId = repositoryB['repositoryId'] as string;

    const listedRepositories = await clientA.sendCommand({
      type: 'repository.list',
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      limit: 1,
    });
    const repositoryRows = listedRepositories['repositories'] as readonly unknown[];
    assert.equal(repositoryRows.length, 1);

    const updatedRepository = await clientA.sendCommand({
      type: 'repository.update',
      repositoryId: repositoryAId,
      metadata: {
        source: 'coverage-test',
      },
    });
    const metadata = (updatedRepository['repository'] as Record<string, unknown>)[
      'metadata'
    ] as Record<string, unknown>;
    assert.equal(metadata['source'], 'coverage-test');

    await assert.rejects(
      () =>
        clientA.sendCommand({
          type: 'repository.update',
          repositoryId: 'repository-missing',
          metadata: {
            source: 'missing',
          },
        }),
      /repository not found/,
    );

    const taskA = (
      await clientA.sendCommand({
        type: 'task.create',
        taskId: 'task-coverage-a',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        repositoryId: repositoryAId,
        title: 'task-a',
        description: '',
      })
    )['task'] as Record<string, unknown>;
    const taskB = (
      await clientA.sendCommand({
        type: 'task.create',
        taskId: 'task-coverage-b',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        repositoryId: repositoryBId,
        title: 'task-b',
        description: '',
      })
    )['task'] as Record<string, unknown>;
    await clientA.sendCommand({
      type: 'task.ready',
      taskId: taskB['taskId'] as string,
    });

    const listedTasks = await clientA.sendCommand({
      type: 'task.list',
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      repositoryId: repositoryBId,
      status: 'ready',
      limit: 1,
    });
    const taskRows = listedTasks['tasks'] as readonly Record<string, unknown>[];
    assert.equal(taskRows.length, 1);
    assert.equal(taskRows[0]?.['taskId'], taskB['taskId']);
    assert.notEqual(taskA['taskId'], taskB['taskId']);

    await clientA.sendCommand({
      type: 'repository.archive',
      repositoryId: repositoryAId,
    });
    const internals = server as unknown as {
      gitStatusByDirectoryId: Map<string, unknown>;
    };
    internals.gitStatusByDirectoryId.set(directoryId, {
      summary: {
        branch: 'main',
        changedFiles: 1,
        additions: 1,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/repo-a',
        commitCount: 10,
        lastCommitAt: '2026-02-17T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'repo-a',
        defaultBranch: 'main',
      },
      repositoryId: repositoryAId,
      lastRefreshedAtMs: Date.now(),
      lastRefreshDurationMs: 1,
    });
    const gitStatusResult = await clientA.sendCommand({
      type: 'directory.git-status',
      directoryId,
    });
    const gitStatuses = gitStatusResult['gitStatuses'] as readonly Record<string, unknown>[];
    assert.equal(gitStatuses.length, 1);
    assert.equal(gitStatuses[0]?.['repositoryId'], repositoryAId);
    assert.equal(gitStatuses[0]?.['repository'], null);
  } finally {
    clientA.close();
    clientB.close();
    await server.close();
  }
});

void test('command module coverage: conversation.title.refresh updates agent threads and skips non-agent paths', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    threadTitleNamer: {
      suggest: async () => 'prompt refresh',
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-thread-refresh',
      tenantId: 'tenant-thread-refresh',
      userId: 'user-thread-refresh',
      workspaceId: 'workspace-thread-refresh',
      path: '/tmp/thread-refresh',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-thread-agent',
      directoryId: 'directory-thread-refresh',
      title: 'seed',
      agentType: 'codex',
      adapterState: {
        harnessThreadTitle: {
          prompts: [
            {
              text: 'stabilize title refresh behavior',
              observedAt: '2026-02-19T00:00:00.000Z',
              hash: 'hash-a',
            },
          ],
        },
      },
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-thread-terminal',
      directoryId: 'directory-thread-refresh',
      title: 'terminal seed',
      agentType: 'terminal',
      adapterState: {
        harnessThreadTitle: {
          prompts: [
            {
              text: 'terminal prompts should be skipped',
              observedAt: '2026-02-19T00:00:00.000Z',
              hash: 'hash-b',
            },
          ],
        },
      },
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-thread-empty',
      directoryId: 'directory-thread-refresh',
      title: 'empty seed',
      agentType: 'claude',
      adapterState: {},
    });

    const first = (await client.sendCommand({
      type: 'conversation.title.refresh',
      conversationId: 'conversation-thread-agent',
    })) as Record<string, unknown>;
    assert.equal(first['status'], 'updated');
    assert.equal((first['conversation'] as Record<string, unknown>)['title'], 'prompt refresh');

    const second = (await client.sendCommand({
      type: 'conversation.title.refresh',
      conversationId: 'conversation-thread-agent',
    })) as Record<string, unknown>;
    assert.equal(second['status'], 'unchanged');

    const nonAgent = (await client.sendCommand({
      type: 'conversation.title.refresh',
      conversationId: 'conversation-thread-terminal',
    })) as Record<string, unknown>;
    assert.equal(nonAgent['status'], 'skipped');
    assert.equal(nonAgent['reason'], 'non-agent-thread');

    const emptyHistory = (await client.sendCommand({
      type: 'conversation.title.refresh',
      conversationId: 'conversation-thread-empty',
    })) as Record<string, unknown>;
    assert.equal(emptyHistory['status'], 'skipped');
    assert.equal(emptyHistory['reason'], 'prompt-history-empty');
  } finally {
    client.close();
    await server.close();
  }
});

void test('command module coverage: task pull enforces project priority, focus mode, fan-out, and freeze blocks', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-a',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      path: '/tmp/pull-a',
    });
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-b',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      path: '/tmp/pull-b',
    });
    await client.sendCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-pull',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      name: 'repo-pull',
      remoteUrl: 'https://github.com/example/repo-pull',
      defaultBranch: 'main',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-project-priority',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      projectId: 'directory-a',
      title: 'project task',
      description: '',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-repository-fanout',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      repositoryId: 'repository-pull',
      title: 'repo task',
      description: '',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-global-fallback',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      title: 'global task',
      description: '',
    });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-project-priority' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-repository-fanout' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-global-fallback' });

    const internals = server as unknown as {
      gitStatusByDirectoryId: Map<string, unknown>;
    };
    const cleanSnapshot = {
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/repo-pull',
        commitCount: 10,
        lastCommitAt: '2026-02-17T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'repo-pull',
        defaultBranch: 'main',
      },
      repositoryId: 'repository-pull',
      lastRefreshedAtMs: Date.now(),
    };
    internals.gitStatusByDirectoryId.set('directory-a', cleanSnapshot);
    internals.gitStatusByDirectoryId.set('directory-b', cleanSnapshot);

    const firstPull = (await client.sendCommand({
      type: 'task.pull',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      controllerId: 'agent-pull',
      directoryId: 'directory-a',
    })) as Record<string, unknown>;
    const firstTask = firstPull['task'] as Record<string, unknown>;
    assert.equal(firstTask['taskId'], 'task-project-priority');
    assert.equal(firstPull['directoryId'], 'directory-a');

    await client.sendCommand({
      type: 'project.settings-update',
      directoryId: 'directory-a',
      taskFocusMode: 'own-only',
    });
    await client.sendCommand({ type: 'task.draft', taskId: 'task-project-priority' });
    const ownOnlyPull = (await client.sendCommand({
      type: 'task.pull',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      controllerId: 'agent-pull',
      directoryId: 'directory-a',
    })) as Record<string, unknown>;
    assert.equal(ownOnlyPull['task'], null);
    assert.match(String(ownOnlyPull['reason']), /no ready task/i);

    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-busy',
      directoryId: 'directory-a',
      title: 'busy',
      agentType: 'codex',
      adapterState: {},
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-busy',
      args: ['resume', 'thread-pull-busy'],
      initialCols: 80,
      initialRows: 24,
    });

    const fanoutPull = (await client.sendCommand({
      type: 'task.pull',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      controllerId: 'agent-pull',
      repositoryId: 'repository-pull',
    })) as Record<string, unknown>;
    const fanoutTask = fanoutPull['task'] as Record<string, unknown>;
    assert.equal(fanoutTask['taskId'], 'task-repository-fanout');
    assert.equal(fanoutPull['directoryId'], 'directory-b');

    await client.sendCommand({
      type: 'automation.policy-set',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      scope: 'repository',
      scopeId: 'repository-pull',
      frozen: true,
      automationEnabled: true,
    });
    const frozenPull = (await client.sendCommand({
      type: 'task.pull',
      tenantId: 'tenant-pull',
      userId: 'user-pull',
      workspaceId: 'workspace-pull',
      controllerId: 'agent-pull',
      directoryId: 'directory-b',
    })) as Record<string, unknown>;
    assert.equal(frozenPull['task'], null);
    assert.equal(frozenPull['availability'], 'blocked-frozen');
    const projectStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-b',
    })) as Record<string, unknown>;
    assert.equal(projectStatus['availability'], 'blocked-frozen');
  } finally {
    client.close();
    await server.close();
  }
});

void test('command module coverage: project status reports availability and policy precedence branches', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const scope = {
      tenantId: 'tenant-status',
      userId: 'user-status',
      workspaceId: 'workspace-status',
    };
    const directories = [
      'directory-untracked',
      'directory-pinned',
      'directory-dirty',
      'directory-occupied',
      'directory-ready',
    ] as const;
    for (const directoryId of directories) {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId,
        ...scope,
        path: `/tmp/${directoryId}`,
      });
    }
    await client.sendCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-status',
      ...scope,
      name: 'repo-status',
      remoteUrl: 'https://github.com/example/repo-status',
      defaultBranch: 'main',
    });

    const internals = server as unknown as {
      gitStatusByDirectoryId: Map<string, unknown>;
    };
    const cleanMainSnapshot = {
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/repo-status',
        commitCount: 10,
        lastCommitAt: '2026-02-17T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'repo-status',
        defaultBranch: 'main',
      },
      repositoryId: 'repository-status',
      lastRefreshedAtMs: Date.now(),
    };
    internals.gitStatusByDirectoryId.set('directory-pinned', {
      ...cleanMainSnapshot,
      summary: {
        ...cleanMainSnapshot.summary,
        branch: 'develop',
      },
    });
    internals.gitStatusByDirectoryId.set('directory-dirty', {
      ...cleanMainSnapshot,
      summary: {
        ...cleanMainSnapshot.summary,
        changedFiles: 3,
      },
    });
    internals.gitStatusByDirectoryId.set('directory-occupied', cleanMainSnapshot);
    internals.gitStatusByDirectoryId.set('directory-ready', cleanMainSnapshot);

    await client.sendCommand({
      type: 'project.settings-update',
      directoryId: 'directory-pinned',
      pinnedBranch: 'main',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-occupied',
      directoryId: 'directory-occupied',
      title: 'occupied',
      agentType: 'codex',
      adapterState: {},
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-occupied',
      args: ['resume', 'thread-occupied'],
      initialCols: 80,
      initialRows: 24,
    });

    const defaultGlobalPolicy = (await client.sendCommand({
      type: 'automation.policy-get',
      scope: 'global',
    })) as Record<string, unknown>;
    const defaultGlobalPolicyRecord = defaultGlobalPolicy['policy'] as Record<string, unknown>;
    assert.equal(defaultGlobalPolicyRecord['policyId'], 'policy-default-global');

    const pinnedSettings = (await client.sendCommand({
      type: 'project.settings-get',
      directoryId: 'directory-pinned',
    })) as Record<string, unknown>;
    const pinnedSettingsRecord = pinnedSettings['settings'] as Record<string, unknown>;
    assert.equal(pinnedSettingsRecord['pinnedBranch'], 'main');

    const pinnedStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-pinned',
    })) as Record<string, unknown>;
    assert.equal(pinnedStatus['availability'], 'blocked-pinned-branch');

    const dirtyStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-dirty',
    })) as Record<string, unknown>;
    assert.equal(dirtyStatus['availability'], 'blocked-dirty');

    const occupiedStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-occupied',
    })) as Record<string, unknown>;
    assert.equal(occupiedStatus['availability'], 'blocked-occupied');

    const untrackedStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-untracked',
    })) as Record<string, unknown>;
    assert.equal(untrackedStatus['availability'], 'blocked-untracked');

    await client.sendCommand({
      type: 'automation.policy-set',
      ...scope,
      scope: 'project',
      scopeId: 'directory-ready',
      automationEnabled: false,
      frozen: false,
    });
    const disabledStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-ready',
    })) as Record<string, unknown>;
    assert.equal(disabledStatus['availability'], 'blocked-disabled');
    assert.equal(
      ((disabledStatus['automation'] as Record<string, unknown>)['source'] as string) ?? null,
      'project',
    );

    await client.sendCommand({
      type: 'automation.policy-set',
      ...scope,
      scope: 'project',
      scopeId: 'directory-ready',
      automationEnabled: true,
      frozen: false,
    });
    await client.sendCommand({
      type: 'automation.policy-set',
      ...scope,
      scope: 'repository',
      scopeId: 'repository-status',
      automationEnabled: true,
      frozen: true,
    });
    const repositoryFrozenStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-pinned',
    })) as Record<string, unknown>;
    assert.equal(repositoryFrozenStatus['availability'], 'blocked-frozen');
    assert.equal(
      (((repositoryFrozenStatus['automation'] as Record<string, unknown>)['source'] as string) ??
        null) as string,
      'repository',
    );

    await client.sendCommand({
      type: 'automation.policy-set',
      ...scope,
      scope: 'repository',
      scopeId: 'repository-status',
      automationEnabled: true,
      frozen: false,
    });
    await client.sendCommand({
      type: 'automation.policy-set',
      ...scope,
      scope: 'global',
      automationEnabled: true,
      frozen: true,
    });
    const globalFrozenStatus = (await client.sendCommand({
      type: 'project.status',
      directoryId: 'directory-untracked',
    })) as Record<string, unknown>;
    assert.equal(globalFrozenStatus['availability'], 'blocked-frozen');
    assert.equal(
      (((globalFrozenStatus['automation'] as Record<string, unknown>)['source'] as string) ??
        null) as string,
      'global',
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('command module coverage: task pull handles conflict fallback and validation errors', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const scope = {
      tenantId: 'tenant-conflict',
      userId: 'user-conflict',
      workspaceId: 'workspace-conflict',
    };
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-conflict',
      ...scope,
      path: '/tmp/conflict',
    });
    await client.sendCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-conflict-a',
      ...scope,
      name: 'repo-conflict-a',
      remoteUrl: 'https://github.com/example/repo-conflict-a',
      defaultBranch: 'main',
    });
    await client.sendCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-conflict-b',
      ...scope,
      name: 'repo-conflict-b',
      remoteUrl: 'https://github.com/example/repo-conflict-b',
      defaultBranch: 'main',
    });

    const internals = server as unknown as {
      gitStatusByDirectoryId: Map<string, unknown>;
      stateStore: {
        claimTask: (input: {
          taskId: string;
          controllerId: string;
          directoryId?: string;
          branchName?: string;
          baseBranch?: string;
        }) => { taskId: string };
      };
    };
    internals.gitStatusByDirectoryId.set('directory-conflict', {
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/repo-conflict-a',
        commitCount: 10,
        lastCommitAt: '2026-02-17T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'repo-conflict-a',
        defaultBranch: 'main',
      },
      repositoryId: 'repository-conflict-a',
      lastRefreshedAtMs: Date.now(),
    });

    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-project-conflict-1',
      ...scope,
      projectId: 'directory-conflict',
      title: 'project conflict 1',
      description: '',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-project-conflict-2',
      ...scope,
      projectId: 'directory-conflict',
      title: 'project conflict 2',
      description: '',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-repository-conflict',
      ...scope,
      repositoryId: 'repository-conflict-a',
      title: 'repo conflict',
      description: '',
    });
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-global-conflict',
      ...scope,
      title: 'global conflict',
      description: '',
    });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-project-conflict-1' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-project-conflict-2' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-repository-conflict' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-global-conflict' });

    const originalClaimTask = internals.stateStore.claimTask.bind(internals.stateStore);
    let rejectedOnce = false;
    internals.stateStore.claimTask = ((input) => {
      if (!rejectedOnce && input.taskId === 'task-project-conflict-1') {
        rejectedOnce = true;
        throw new Error('task already claimed: task-project-conflict-1');
      }
      return originalClaimTask(input);
    }) as typeof internals.stateStore.claimTask;
    const conflictedPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
      branchName: 'feature/task',
      baseBranch: 'main',
    })) as Record<string, unknown>;
    const conflictedTask = conflictedPull['task'] as Record<string, unknown>;
    assert.equal(conflictedTask['taskId'], 'task-project-conflict-2');
    internals.stateStore.claimTask = originalClaimTask;

    await client.sendCommand({
      type: 'task.update',
      taskId: 'task-project-conflict-2',
      projectId: null,
    });
    const projectScopedList = (await client.sendCommand({
      type: 'task.list',
      ...scope,
      projectId: 'directory-conflict',
      scopeKind: 'project',
      limit: 5,
    })) as Record<string, unknown>;
    assert.equal((projectScopedList['tasks'] as readonly unknown[]).length >= 1, true);

    await client.sendCommand({ type: 'task.draft', taskId: 'task-project-conflict-1' });
    await client.sendCommand({ type: 'task.draft', taskId: 'task-project-conflict-2' });
    const repositoryFallbackPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
    })) as Record<string, unknown>;
    const repositoryFallbackTask = repositoryFallbackPull['task'] as Record<string, unknown>;
    assert.equal(repositoryFallbackTask['taskId'], 'task-repository-conflict');

    await client.sendCommand({ type: 'task.ready', taskId: 'task-repository-conflict' });
    await client.sendCommand({ type: 'task.draft', taskId: 'task-global-conflict' });
    internals.stateStore.claimTask = ((input) => {
      if (input.taskId === 'task-repository-conflict') {
        throw new Error('task already claimed: task-repository-conflict');
      }
      return originalClaimTask(input);
    }) as typeof internals.stateStore.claimTask;
    const repositoryConflictPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
    })) as Record<string, unknown>;
    assert.equal(repositoryConflictPull['task'], null);
    assert.equal(repositoryConflictPull['availability'], 'ready');

    await client.sendCommand({ type: 'task.draft', taskId: 'task-repository-conflict' });
    await client.sendCommand({ type: 'task.ready', taskId: 'task-global-conflict' });
    internals.stateStore.claimTask = ((input) => {
      if (input.taskId === 'task-global-conflict') {
        throw new Error('task already claimed: task-global-conflict');
      }
      return originalClaimTask(input);
    }) as typeof internals.stateStore.claimTask;
    const globalConflictPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
    })) as Record<string, unknown>;
    assert.equal(globalConflictPull['task'], null);
    assert.match(String(globalConflictPull['reason']), /no ready task/i);
    internals.stateStore.claimTask = originalClaimTask;
    await client.sendCommand({ type: 'task.draft', taskId: 'task-repository-conflict' });
    const globalFallbackPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
    })) as Record<string, unknown>;
    const globalFallbackTask = globalFallbackPull['task'] as Record<string, unknown>;
    assert.equal(globalFallbackTask['taskId'], 'task-global-conflict');

    const mismatchPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      directoryId: 'directory-conflict',
      repositoryId: 'repository-conflict-b',
    })) as Record<string, unknown>;
    assert.equal(mismatchPull['availability'], 'blocked-repository-mismatch');

    const bestBlockedPull = (await client.sendCommand({
      type: 'task.pull',
      ...scope,
      controllerId: 'agent-conflict',
      repositoryId: 'repository-conflict-b',
    })) as Record<string, unknown>;
    assert.equal(bestBlockedPull['directoryId'], 'directory-conflict');
    assert.equal(bestBlockedPull['availability'], 'blocked-repository-mismatch');

    const noEligibleProjectPull = (await client.sendCommand({
      type: 'task.pull',
      tenantId: 'tenant-empty',
      userId: 'user-empty',
      workspaceId: 'workspace-empty',
      controllerId: 'agent-empty',
      repositoryId: 'repository-conflict-a',
    })) as Record<string, unknown>;
    assert.equal(noEligibleProjectPull['directoryId'], null);
    assert.equal(noEligibleProjectPull['availability'], 'blocked-untracked');
    assert.equal(noEligibleProjectPull['settings'], null);

    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'task.pull',
          ...scope,
          controllerId: 'agent-conflict',
        }),
      /requires directoryId or repositoryId/,
    );
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'task.pull',
          ...scope,
          controllerId: 'agent-conflict',
          directoryId: 'directory-missing',
        }),
      /directory not found/,
    );
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'task.pull',
          tenantId: 'tenant-mismatch',
          userId: 'user-mismatch',
          workspaceId: 'workspace-mismatch',
          controllerId: 'agent-conflict',
          directoryId: 'directory-conflict',
        }),
      /task pull scope mismatch/,
    );
    internals.stateStore.claimTask = ((input) => {
      if (input.taskId === 'task-global-conflict') {
        throw new Error('unexpected claim failure');
      }
      return originalClaimTask(input);
    }) as typeof internals.stateStore.claimTask;
    await client.sendCommand({ type: 'task.ready', taskId: 'task-global-conflict' });
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'task.pull',
          ...scope,
          controllerId: 'agent-conflict',
          directoryId: 'directory-conflict',
        }),
      /unexpected claim failure/,
    );
    internals.stateStore.claimTask = originalClaimTask;
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'project.status',
          directoryId: 'directory-missing',
        }),
      /directory not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});
