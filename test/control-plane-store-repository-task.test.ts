import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from '../src/store/sqlite.ts';
import { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-control-plane-store-'));
  return join(dir, 'control-plane.sqlite');
}

void test('control-plane store manages repositories and task lifecycle', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    store.upsertDirectory({
      directoryId: 'dir-task-a',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      path: '/tmp/task-a',
    });
    store.upsertDirectory({
      directoryId: 'dir-task-b',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      path: '/tmp/task-b',
    });
    store.upsertDirectory({
      directoryId: 'dir-task-other',
      tenantId: 'tenant-other',
      userId: 'user-other',
      workspaceId: 'workspace-other',
      path: '/tmp/task-other',
    });

    const repo = store.upsertRepository({
      repositoryId: 'repo-1',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Harness',
      remoteUrl: 'https://github.com/jmoyers/harness.git',
      defaultBranch: 'main',
      metadata: {
        provider: 'github',
      },
    });
    assert.equal(repo.repositoryId, 'repo-1');
    assert.equal(repo.defaultBranch, 'main');

    const sameRepo = store.upsertRepository({
      repositoryId: 'repo-1',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Harness',
      remoteUrl: 'https://github.com/jmoyers/harness.git',
      defaultBranch: 'main',
      metadata: {
        provider: 'github',
      },
    });
    assert.equal(sameRepo.repositoryId, 'repo-1');

    const updatedRepo = store.upsertRepository({
      repositoryId: 'repo-1',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Harness Updated',
      remoteUrl: 'https://github.com/jmoyers/harness.git',
      defaultBranch: 'develop',
      metadata: {
        provider: 'github',
        owner: 'jmoyers',
      },
    });
    assert.equal(updatedRepo.name, 'Harness Updated');
    assert.equal(updatedRepo.defaultBranch, 'develop');

    assert.equal(store.getRepository('missing-repository'), null);
    assert.equal(store.listRepositories().length, 1);
    assert.equal(store.listRepositories({ includeArchived: true }).length, 1);

    const archivedRepo = store.archiveRepository('repo-1');
    assert.notEqual(archivedRepo.archivedAt, null);
    const archivedRepoAgain = store.archiveRepository('repo-1');
    assert.equal(archivedRepoAgain.archivedAt, archivedRepo.archivedAt);
    assert.equal(store.listRepositories({}).length, 0);
    assert.equal(store.listRepositories({ includeArchived: true }).length, 1);

    const restoredByUrl = store.upsertRepository({
      repositoryId: 'repo-restore-id',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Harness Updated',
      remoteUrl: 'https://github.com/jmoyers/harness.git',
      defaultBranch: 'develop',
      metadata: {
        provider: 'github',
        owner: 'jmoyers',
      },
    });
    assert.equal(restoredByUrl.repositoryId, 'repo-1');
    assert.equal(restoredByUrl.archivedAt, null);

    const restoredNoop = store.upsertRepository({
      repositoryId: 'repo-restore-noop',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Harness Updated',
      remoteUrl: 'https://github.com/jmoyers/harness.git',
      defaultBranch: 'develop',
      metadata: {
        provider: 'github',
        owner: 'jmoyers',
      },
    });
    assert.equal(restoredNoop.repositoryId, 'repo-1');

    assert.throws(
      () =>
        store.upsertRepository({
          repositoryId: 'repo-1',
          tenantId: 'tenant-other',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          name: 'scope mismatch',
          remoteUrl: 'https://github.com/jmoyers/harness.git',
        }),
      /scope mismatch/,
    );
    assert.throws(() => store.archiveRepository('missing-repository'), /repository not found/);

    assert.equal(store.updateRepository('missing-repository', { name: 'x' }), null);

    const updateRepositoryFull = store.updateRepository('repo-1', {
      name: 'Harness Final',
      remoteUrl: 'https://github.com/jmoyers/harness-final.git',
      defaultBranch: 'release',
      metadata: {
        tier: 'critical',
      },
    });
    assert.equal(updateRepositoryFull?.name, 'Harness Final');
    assert.equal(updateRepositoryFull?.remoteUrl, 'https://github.com/jmoyers/harness-final.git');
    assert.equal(updateRepositoryFull?.defaultBranch, 'release');

    const updateRepositoryNoop = store.updateRepository('repo-1', {});
    assert.equal(updateRepositoryNoop?.name, 'Harness Final');

    store.upsertRepository({
      repositoryId: 'repo-2',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      name: 'Repo 2',
      remoteUrl: 'https://github.com/jmoyers/repo-2.git',
    });
    store.upsertRepository({
      repositoryId: 'repo-other-scope',
      tenantId: 'tenant-other',
      userId: 'user-other',
      workspaceId: 'workspace-other',
      name: 'Repo Other Scope',
      remoteUrl: 'https://github.com/jmoyers/repo-other.git',
    });

    const taskA = store.createTask({
      taskId: 'task-a',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      title: 'task a',
    });
    const taskB = store.createTask({
      taskId: 'task-b',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      repositoryId: 'repo-1',
      title: 'task b',
      description: 'description b',
      linear: {
        issueId: 'linear-issue-1',
        identifier: 'ENG-42',
        teamId: 'team-eng',
        projectId: 'project-roadmap',
        stateId: 'state-backlog',
        assigneeId: 'user-123',
        priority: 2,
        estimate: 3,
        dueDate: '2026-03-01',
        labelIds: ['bug', 'backend'],
      },
    });
    const taskC = store.createTask({
      taskId: 'task-c',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      repositoryId: 'repo-2',
      title: 'task c',
    });
    const taskProject = store.createTask({
      taskId: 'task-project',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      projectId: 'dir-task-a',
      title: 'project scoped',
    });
    assert.equal(taskA.orderIndex, 0);
    assert.equal(taskB.orderIndex, 1);
    assert.equal(taskC.orderIndex, 2);
    assert.equal(taskProject.scopeKind, 'project');
    assert.equal(taskProject.projectId, 'dir-task-a');
    assert.equal(taskA.scopeKind, 'global');
    assert.equal(taskA.projectId, null);
    assert.equal(taskB.scopeKind, 'repository');
    assert.equal(taskB.projectId, null);
    assert.equal(taskA.linear.issueId, null);
    assert.equal(taskA.linear.labelIds.length, 0);
    assert.equal(taskB.linear.identifier, 'ENG-42');
    assert.equal(taskB.linear.priority, 2);
    assert.deepEqual(taskB.linear.labelIds, ['bug', 'backend']);

    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-a',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: 'duplicate',
        }),
      /task already exists/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-blank',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: '  ',
        }),
      /expected non-empty title/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-missing-repository',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          repositoryId: 'missing-repository',
          title: 'bad',
        }),
      /repository not found/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-repository-scope-mismatch',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          repositoryId: 'repo-other-scope',
          title: 'bad',
        }),
      /scope mismatch/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-project-missing',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          projectId: 'dir-does-not-exist',
          title: 'bad project',
        }),
      /directory not found/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-invalid-linear-priority',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: 'bad linear priority',
          linear: {
            priority: 7,
          },
        }),
      /linear\.priority/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-invalid-linear-due-date',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: 'bad linear date',
          linear: {
            dueDate: '03-01-2026',
          },
        }),
      /YYYY-MM-DD/,
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-invalid-linear-estimate',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: 'bad linear estimate',
          linear: {
            estimate: -1,
          },
        }),
      /linear\.estimate/,
    );

    const taskLinearNullLabels = store.createTask({
      taskId: 'task-linear-null-labels',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      title: 'null labels',
      linear: {
        labelIds: null,
      },
    });
    assert.deepEqual(taskLinearNullLabels.linear.labelIds, []);

    assert.equal(store.getTask('missing-task'), null);
    assert.equal(store.listTasks().length, 5);
    assert.equal(
      store.listTasks({
        tenantId: 'tenant-task',
        userId: 'user-task',
        workspaceId: 'workspace-task',
      }).length,
      5,
    );
    assert.equal(store.listTasks({ repositoryId: 'repo-1' }).length, 1);
    assert.equal(store.listTasks({ projectId: 'dir-task-a' }).length, 1);
    assert.equal(store.listTasks({ scopeKind: 'project' }).length, 1);
    assert.equal(store.listTasks({ scopeKind: 'repository' }).length, 2);
    assert.equal(store.listTasks({ scopeKind: 'global' }).length, 2);
    assert.equal(store.listTasks({ status: 'draft' }).length, 5);

    assert.equal(store.updateTask('missing-task', { title: 'x' }), null);
    const updateTaskFull = store.updateTask('task-a', {
      title: 'task a updated',
      description: 'description a updated',
      repositoryId: 'repo-1',
      linear: {
        issueId: 'linear-issue-2',
        identifier: 'ENG-43',
        priority: 1,
        estimate: 5,
        labelIds: ['feature'],
      },
    });
    assert.equal(updateTaskFull?.title, 'task a updated');
    assert.equal(updateTaskFull?.repositoryId, 'repo-1');
    assert.equal(updateTaskFull?.linear.identifier, 'ENG-43');
    assert.equal(updateTaskFull?.linear.priority, 1);
    assert.deepEqual(updateTaskFull?.linear.labelIds, ['feature']);

    const updateTaskNoop = store.updateTask('task-a', {
      title: 'task a renamed only',
    });
    assert.equal(updateTaskNoop?.title, 'task a renamed only');

    const updateTaskClearRepository = store.updateTask('task-a', {
      repositoryId: null,
    });
    assert.equal(updateTaskClearRepository?.repositoryId, null);
    assert.equal(updateTaskClearRepository?.scopeKind, 'global');

    const updateTaskToProjectScope = store.updateTask('task-a', {
      projectId: 'dir-task-a',
    });
    assert.equal(updateTaskToProjectScope?.scopeKind, 'project');
    assert.equal(updateTaskToProjectScope?.projectId, 'dir-task-a');
    const updateTaskResetLinear = store.updateTask('task-a', {
      linear: null,
    });
    assert.equal(updateTaskResetLinear?.linear.issueId, null);
    assert.equal(updateTaskResetLinear?.linear.priority, null);
    assert.deepEqual(updateTaskResetLinear?.linear.labelIds, []);

    assert.throws(
      () =>
        store.updateTask('task-a', {
          projectId: 'missing-directory',
        }),
      /directory not found/,
    );
    assert.throws(
      () =>
        store.updateTask('task-a', {
          repositoryId: 'missing-repository',
        }),
      /repository not found/,
    );
    assert.throws(
      () =>
        store.updateTask('task-a', {
          repositoryId: 'repo-other-scope',
        }),
      /scope mismatch/,
    );
    assert.throws(
      () =>
        store.updateTask('task-a', {
          linear: {
            labelIds: ['ok', '  '],
          },
        }),
      /linear\.labelIds/,
    );

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'missing-task',
          controllerId: 'agent-1',
        }),
      /task not found/,
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: '   ',
        }),
      /expected non-empty controllerId/,
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-b',
          controllerId: 'agent-1',
        }),
      /cannot claim draft task/,
    );

    const defaultProjectSettings = store.getProjectSettings('dir-task-a');
    assert.equal(defaultProjectSettings.pinnedBranch, null);
    assert.equal(defaultProjectSettings.taskFocusMode, 'balanced');
    assert.equal(defaultProjectSettings.threadSpawnMode, 'new-thread');
    const updatedProjectSettings = store.updateProjectSettings({
      directoryId: 'dir-task-a',
      pinnedBranch: 'main',
      taskFocusMode: 'own-only',
      threadSpawnMode: 'reuse-thread',
    });
    assert.equal(updatedProjectSettings.pinnedBranch, 'main');
    assert.equal(updatedProjectSettings.taskFocusMode, 'own-only');
    assert.equal(updatedProjectSettings.threadSpawnMode, 'reuse-thread');
    assert.throws(() => store.getProjectSettings('missing-directory'), /directory not found/);

    const defaultGlobalPolicy = store.getAutomationPolicy({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      scope: 'global',
    });
    assert.equal(defaultGlobalPolicy, null);
    const globalPolicy = store.updateAutomationPolicy({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      scope: 'global',
      frozen: true,
      automationEnabled: true,
    });
    assert.equal(globalPolicy.frozen, true);
    const repoPolicy = store.updateAutomationPolicy({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      scope: 'repository',
      scopeId: 'repo-1',
      frozen: false,
      automationEnabled: true,
    });
    assert.equal(repoPolicy.scope, 'repository');
    const projectPolicy = store.updateAutomationPolicy({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      scope: 'project',
      scopeId: 'dir-task-a',
      automationEnabled: false,
      frozen: false,
    });
    assert.equal(projectPolicy.scope, 'project');
    assert.equal(
      store.getAutomationPolicy({
        tenantId: 'tenant-task',
        userId: 'user-task',
        workspaceId: 'workspace-task',
        scope: 'project',
        scopeId: 'dir-task-a',
      })?.automationEnabled,
      false,
    );

    const readyTaskA = store.readyTask('task-a');
    assert.equal(readyTaskA.status, 'ready');

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-1',
          directoryId: 'missing-directory',
        }),
      /directory not found/,
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-1',
          directoryId: 'dir-task-other',
        }),
      /scope mismatch/,
    );

    const claimedTaskA = store.claimTask({
      taskId: 'task-a',
      controllerId: 'agent-1',
      directoryId: 'dir-task-a',
      branchName: 'feature/task-a',
      baseBranch: 'main',
    });
    assert.equal(claimedTaskA.status, 'in-progress');
    assert.equal(claimedTaskA.claimedByControllerId, 'agent-1');
    assert.equal(claimedTaskA.claimedByDirectoryId, 'dir-task-a');
    assert.equal(claimedTaskA.branchName, 'feature/task-a');
    assert.equal(claimedTaskA.baseBranch, 'main');

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-2',
          directoryId: 'dir-task-a',
        }),
      /task already claimed/,
    );

    const completedTaskA = store.completeTask('task-a');
    assert.equal(completedTaskA.status, 'completed');
    assert.notEqual(completedTaskA.completedAt, null);

    const completedTaskAAgain = store.completeTask('task-a');
    assert.equal(completedTaskAAgain.status, 'completed');

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-2',
        }),
      /cannot claim completed task/,
    );

    const requeuedTaskA = store.queueTask('task-a');
    assert.equal(requeuedTaskA.status, 'ready');
    assert.equal(requeuedTaskA.claimedByControllerId, null);
    assert.equal(requeuedTaskA.claimedByDirectoryId, null);
    assert.equal(requeuedTaskA.branchName, null);
    assert.equal(requeuedTaskA.baseBranch, null);
    assert.equal(requeuedTaskA.completedAt, null);

    const readyTaskB = store.readyTask('task-b');
    assert.equal(readyTaskB.status, 'ready');
    const claimedTaskWithoutDirectory = store.claimTask({
      taskId: 'task-b',
      controllerId: 'agent-3',
    });
    assert.equal(claimedTaskWithoutDirectory.claimedByDirectoryId, null);
    const draftedTaskB = store.draftTask('task-b');
    assert.equal(draftedTaskB.status, 'draft');
    assert.equal(draftedTaskB.claimedByControllerId, null);
    assert.equal(draftedTaskB.claimedByDirectoryId, null);
    assert.equal(draftedTaskB.claimedAt, null);
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-b',
          controllerId: 'agent-4',
        }),
      /cannot claim draft task/,
    );

    assert.throws(() => store.completeTask('missing-task'), /task not found/);
    assert.throws(() => store.queueTask('missing-task'), /task not found/);
    assert.throws(() => store.draftTask('missing-task'), /task not found/);

    assert.throws(
      () =>
        store.reorderTasks({
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          orderedTaskIds: ['task-c', 'task-c'],
        }),
      /duplicate ids/,
    );
    assert.throws(
      () =>
        store.reorderTasks({
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          orderedTaskIds: ['missing-task'],
        }),
      /not found in scope/,
    );

    const reordered = store.reorderTasks({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      orderedTaskIds: ['task-c', 'task-a', '   '],
    });
    assert.equal(reordered[0]?.taskId, 'task-c');
    assert.equal(reordered[1]?.taskId, 'task-a');

    assert.equal(store.deleteTask('task-c'), true);
    assert.throws(() => store.deleteTask('task-c'), /task not found/);
  } finally {
    store.close();
  }
});

void test('control-plane store repository and task normalization guards are strict', () => {
  const storePath = tempStorePath();
  const store = new SqliteControlPlaneStore(storePath);
  try {
    store.upsertRepository({
      repositoryId: 'repo-normalize',
      tenantId: 'tenant-normalize',
      userId: 'user-normalize',
      workspaceId: 'workspace-normalize',
      name: 'normalize',
      remoteUrl: 'https://github.com/jmoyers/normalize.git',
    });
    store.createTask({
      taskId: 'task-normalize',
      tenantId: 'tenant-normalize',
      userId: 'user-normalize',
      workspaceId: 'workspace-normalize',
      repositoryId: 'repo-normalize',
      title: 'normalize task',
    });
  } finally {
    store.close();
  }

  const db = new DatabaseSync(storePath);
  try {
    db.prepare('UPDATE repositories SET metadata_json = ? WHERE repository_id = ?').run(
      '[]',
      'repo-normalize',
    );
  } finally {
    db.close();
  }
  const reopenedArrayMetadata = new SqliteControlPlaneStore(storePath);
  try {
    assert.deepEqual(reopenedArrayMetadata.getRepository('repo-normalize')?.metadata, {});
  } finally {
    reopenedArrayMetadata.close();
  }

  const dbMalformed = new DatabaseSync(storePath);
  try {
    dbMalformed
      .prepare('UPDATE repositories SET metadata_json = ? WHERE repository_id = ?')
      .run('{bad json', 'repo-normalize');
  } finally {
    dbMalformed.close();
  }
  const reopenedMalformedMetadata = new SqliteControlPlaneStore(storePath);
  try {
    assert.deepEqual(reopenedMalformedMetadata.getRepository('repo-normalize')?.metadata, {});
  } finally {
    reopenedMalformedMetadata.close();
  }

  const dbInvalidMetadataType = new DatabaseSync(storePath);
  try {
    dbInvalidMetadataType
      .prepare('UPDATE repositories SET metadata_json = ? WHERE repository_id = ?')
      .run(Buffer.from([1, 2, 3]), 'repo-normalize');
  } finally {
    dbInvalidMetadataType.close();
  }
  const reopenedInvalidMetadataType = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(
      () => reopenedInvalidMetadataType.getRepository('repo-normalize'),
      /metadata_json/,
    );
  } finally {
    reopenedInvalidMetadataType.close();
  }

  const dbMalformedTaskLinear = new DatabaseSync(storePath);
  try {
    dbMalformedTaskLinear
      .prepare('UPDATE tasks SET linear_json = ? WHERE task_id = ?')
      .run('{bad json', 'task-normalize');
  } finally {
    dbMalformedTaskLinear.close();
  }
  const reopenedMalformedTaskLinear = new SqliteControlPlaneStore(storePath);
  try {
    assert.equal(reopenedMalformedTaskLinear.getTask('task-normalize')?.linear.issueId, null);
    assert.deepEqual(reopenedMalformedTaskLinear.getTask('task-normalize')?.linear.labelIds, []);
  } finally {
    reopenedMalformedTaskLinear.close();
  }

  const dbArrayTaskLinear = new DatabaseSync(storePath);
  try {
    dbArrayTaskLinear
      .prepare('UPDATE tasks SET linear_json = ? WHERE task_id = ?')
      .run('[]', 'task-normalize');
  } finally {
    dbArrayTaskLinear.close();
  }
  const reopenedArrayTaskLinear = new SqliteControlPlaneStore(storePath);
  try {
    assert.equal(reopenedArrayTaskLinear.getTask('task-normalize')?.linear.priority, null);
  } finally {
    reopenedArrayTaskLinear.close();
  }

  const dbNullLabelsTaskLinear = new DatabaseSync(storePath);
  try {
    dbNullLabelsTaskLinear
      .prepare('UPDATE tasks SET linear_json = ? WHERE task_id = ?')
      .run('{"labelIds":null}', 'task-normalize');
  } finally {
    dbNullLabelsTaskLinear.close();
  }
  const reopenedNullLabelsTaskLinear = new SqliteControlPlaneStore(storePath);
  try {
    assert.deepEqual(reopenedNullLabelsTaskLinear.getTask('task-normalize')?.linear.labelIds, []);
  } finally {
    reopenedNullLabelsTaskLinear.close();
  }

  const dbInvalidLabelsTaskLinear = new DatabaseSync(storePath);
  try {
    dbInvalidLabelsTaskLinear
      .prepare('UPDATE tasks SET linear_json = ? WHERE task_id = ?')
      .run('{"labelIds":[1]}', 'task-normalize');
  } finally {
    dbInvalidLabelsTaskLinear.close();
  }
  const reopenedInvalidLabelsTaskLinear = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(() => reopenedInvalidLabelsTaskLinear.getTask('task-normalize'), /labelIds/);
  } finally {
    reopenedInvalidLabelsTaskLinear.close();
  }

  const dbInvalidTaskLinearType = new DatabaseSync(storePath);
  try {
    dbInvalidTaskLinearType
      .prepare('UPDATE tasks SET linear_json = ? WHERE task_id = ?')
      .run(Buffer.from([1, 2, 3]), 'task-normalize');
  } finally {
    dbInvalidTaskLinearType.close();
  }
  const reopenedInvalidTaskLinearType = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(() => reopenedInvalidTaskLinearType.getTask('task-normalize'), /linear_json/);
  } finally {
    reopenedInvalidTaskLinearType.close();
  }

  const dbInvalidTaskRows = new DatabaseSync(storePath);
  try {
    dbInvalidTaskRows.prepare('DELETE FROM tasks;').run();
    dbInvalidTaskRows.exec(`
      INSERT INTO tasks (
        task_id,
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        title,
        description,
        status,
        order_index,
        claimed_by_controller_id,
        claimed_by_directory_id,
        branch_name,
        base_branch,
        claimed_at,
        completed_at,
        created_at,
        updated_at
      ) VALUES (
        'task-invalid-status',
        'tenant-normalize',
        'user-normalize',
        'workspace-normalize',
        'repo-normalize',
        'bad status',
        '',
        'waiting',
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-16T00:00:00.000Z',
        '2026-02-16T00:00:00.000Z'
      );
    `);
    dbInvalidTaskRows.exec(`
      INSERT INTO tasks (
        task_id,
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        title,
        description,
        status,
        order_index,
        claimed_by_controller_id,
        claimed_by_directory_id,
        branch_name,
        base_branch,
        claimed_at,
        completed_at,
        created_at,
        updated_at
      ) VALUES (
        'task-invalid-order-index',
        'tenant-normalize',
        'user-normalize',
        'workspace-normalize',
        'repo-normalize',
        'bad order index',
        '',
        'queued',
        zeroblob(1),
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-16T00:00:00.000Z',
        '2026-02-16T00:00:00.000Z'
      );
    `);
    dbInvalidTaskRows.exec(`
      INSERT INTO tasks (
        task_id,
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        title,
        description,
        linear_json,
        status,
        order_index,
        claimed_by_controller_id,
        claimed_by_directory_id,
        branch_name,
        base_branch,
        claimed_at,
        completed_at,
        created_at,
        updated_at
      ) VALUES (
        'task-invalid-linear-priority',
        'tenant-normalize',
        'user-normalize',
        'workspace-normalize',
        'repo-normalize',
        'bad linear priority',
        '',
        '{"priority": 99}',
        'ready',
        1,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-16T00:00:00.000Z',
        '2026-02-16T00:00:00.000Z'
      );
    `);
  } finally {
    dbInvalidTaskRows.close();
  }

  const reopenedInvalidTaskRows = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(() => reopenedInvalidTaskRows.getTask('task-invalid-status'), /task status enum/);
    assert.throws(
      () => reopenedInvalidTaskRows.getTask('task-invalid-order-index'),
      /finite number/,
    );
    assert.throws(
      () => reopenedInvalidTaskRows.getTask('task-invalid-linear-priority'),
      /linear\.priority/,
    );
  } finally {
    reopenedInvalidTaskRows.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});

void test('control-plane store repository and task rollback guards cover impossible null checks', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const originalGetRepository = store.getRepository.bind(store);
    const originalGetTask = store.getTask.bind(store);

    store.getRepository = (() => null) as typeof store.getRepository;
    assert.throws(
      () =>
        store.upsertRepository({
          repositoryId: 'repo-insert-fail',
          tenantId: 'tenant-rollback',
          userId: 'user-rollback',
          workspaceId: 'workspace-rollback',
          name: 'insert fail',
          remoteUrl: 'https://github.com/jmoyers/repo-insert-fail.git',
        }),
      /repository insert failed/,
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-update-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'update fail',
      remoteUrl: 'https://github.com/jmoyers/repo-update-fail.git',
    });
    let updateFailCalls = 0;
    store.getRepository = ((repositoryId: string) => {
      if (repositoryId === 'repo-update-fail') {
        updateFailCalls += 1;
        if (updateFailCalls >= 2) {
          return null;
        }
      }
      return originalGetRepository(repositoryId);
    }) as typeof store.getRepository;
    assert.throws(
      () =>
        store.upsertRepository({
          repositoryId: 'repo-update-fail',
          tenantId: 'tenant-rollback',
          userId: 'user-rollback',
          workspaceId: 'workspace-rollback',
          name: 'update fail changed',
          remoteUrl: 'https://github.com/jmoyers/repo-update-fail.git',
        }),
      /missing after update/,
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-restore-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'restore fail',
      remoteUrl: 'https://github.com/jmoyers/repo-restore-fail.git',
    });
    store.archiveRepository('repo-restore-fail');
    store.getRepository = ((repositoryId: string) => {
      if (repositoryId === 'repo-restore-fail') {
        return null;
      }
      return originalGetRepository(repositoryId);
    }) as typeof store.getRepository;
    assert.throws(
      () =>
        store.upsertRepository({
          repositoryId: 'repo-restore-fail-new',
          tenantId: 'tenant-rollback',
          userId: 'user-rollback',
          workspaceId: 'workspace-rollback',
          name: 'restore fail changed',
          remoteUrl: 'https://github.com/jmoyers/repo-restore-fail.git',
        }),
      /missing after restore/,
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-archive-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'archive fail',
      remoteUrl: 'https://github.com/jmoyers/repo-archive-fail.git',
    });
    let archiveFailCalls = 0;
    store.getRepository = ((repositoryId: string) => {
      if (repositoryId === 'repo-archive-fail') {
        archiveFailCalls += 1;
        if (archiveFailCalls >= 2) {
          return null;
        }
      }
      return originalGetRepository(repositoryId);
    }) as typeof store.getRepository;
    assert.throws(() => store.archiveRepository('repo-archive-fail'), /missing after archive/);
    store.getRepository = originalGetRepository;

    store.getTask = (() => null) as typeof store.getTask;
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-insert-fail',
          tenantId: 'tenant-rollback',
          userId: 'user-rollback',
          workspaceId: 'workspace-rollback',
          title: 'insert fail',
        }),
      /task insert failed/,
    );
    store.getTask = originalGetTask;

    store.upsertDirectory({
      directoryId: 'dir-rollback',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      path: '/tmp/dir-rollback',
    });

    store.createTask({
      taskId: 'task-claim-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'claim fail',
    });
    store.readyTask('task-claim-fail');
    let claimFailCalls = 0;
    store.getTask = ((taskId: string) => {
      if (taskId === 'task-claim-fail') {
        claimFailCalls += 1;
        if (claimFailCalls >= 2) {
          return null;
        }
      }
      return originalGetTask(taskId);
    }) as typeof store.getTask;
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-claim-fail',
          controllerId: 'agent-rollback',
          directoryId: 'dir-rollback',
        }),
      /missing after claim/,
    );
    store.getTask = originalGetTask;

    store.createTask({
      taskId: 'task-complete-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'complete fail',
    });
    let completeFailCalls = 0;
    store.getTask = ((taskId: string) => {
      if (taskId === 'task-complete-fail') {
        completeFailCalls += 1;
        if (completeFailCalls >= 2) {
          return null;
        }
      }
      return originalGetTask(taskId);
    }) as typeof store.getTask;
    assert.throws(() => store.completeTask('task-complete-fail'), /missing after complete/);
    store.getTask = originalGetTask;

    store.createTask({
      taskId: 'task-queue-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'queue fail',
    });
    let queueFailCalls = 0;
    store.getTask = ((taskId: string) => {
      if (taskId === 'task-queue-fail') {
        queueFailCalls += 1;
        if (queueFailCalls >= 2) {
          return null;
        }
      }
      return originalGetTask(taskId);
    }) as typeof store.getTask;
    assert.throws(() => store.queueTask('task-queue-fail'), /missing after ready/);

    store.createTask({
      taskId: 'task-draft-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'draft fail',
    });
    store.readyTask('task-draft-fail');
    let draftFailCalls = 0;
    store.getTask = ((taskId: string) => {
      if (taskId === 'task-draft-fail') {
        draftFailCalls += 1;
        if (draftFailCalls >= 2) {
          return null;
        }
      }
      return originalGetTask(taskId);
    }) as typeof store.getTask;
    assert.throws(() => store.draftTask('task-draft-fail'), /missing after draft/);
  } finally {
    store.close();
  }
});
