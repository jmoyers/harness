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
    assert.equal(store.getTask('missing-task'), null);
    assert.equal(store.listTasks().length, 4);
    assert.equal(
      store.listTasks({
        tenantId: 'tenant-task',
        userId: 'user-task',
        workspaceId: 'workspace-task',
      }).length,
      4,
    );
    assert.equal(store.listTasks({ repositoryId: 'repo-1' }).length, 1);
    assert.equal(store.listTasks({ projectId: 'dir-task-a' }).length, 1);
    assert.equal(store.listTasks({ scopeKind: 'project' }).length, 1);
    assert.equal(store.listTasks({ scopeKind: 'repository' }).length, 2);
    assert.equal(store.listTasks({ scopeKind: 'global' }).length, 1);
    assert.equal(store.listTasks({ status: 'draft' }).length, 4);

    assert.equal(store.updateTask('missing-task', { title: 'x' }), null);
    const updateTaskFull = store.updateTask('task-a', {
      title: 'task a updated',
      description: 'description a updated',
      repositoryId: 'repo-1',
    });
    assert.equal(updateTaskFull?.title, 'task a updated');
    assert.equal(updateTaskFull?.repositoryId, 'repo-1');

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

void test('control-plane store migrates legacy tasks schema before creating scope index', () => {
  const storePath = tempStorePath();
  const legacy = new DatabaseSync(storePath);
  try {
    legacy.exec(`
      CREATE TABLE directories (
        directory_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
    `);
    legacy.exec(`
      CREATE TABLE repositories (
        repository_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
    `);
    legacy.exec(`
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT REFERENCES repositories(repository_id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        claimed_by_controller_id TEXT,
        claimed_by_directory_id TEXT REFERENCES directories(directory_id),
        branch_name TEXT,
        base_branch TEXT,
        claimed_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.exec(`
      INSERT INTO repositories (
        repository_id,
        tenant_id,
        user_id,
        workspace_id,
        name,
        remote_url,
        default_branch,
        metadata_json,
        created_at,
        archived_at
      ) VALUES (
        'repo-legacy',
        'tenant-legacy',
        'user-legacy',
        'workspace-legacy',
        'legacy repo',
        'https://example.com/legacy.git',
        'main',
        '{}',
        '2026-02-18T00:00:00.000Z',
        NULL
      );
    `);
    legacy.exec(`
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
        'task-legacy',
        'tenant-legacy',
        'user-legacy',
        'workspace-legacy',
        'repo-legacy',
        'legacy task',
        '',
        'draft',
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-18T00:00:00.000Z',
        '2026-02-18T00:00:00.000Z'
      );
    `);
  } finally {
    legacy.close();
  }

  const store = new SqliteControlPlaneStore(storePath);
  try {
    const migratedTask = store.getTask('task-legacy');
    assert.equal(migratedTask?.scopeKind, 'repository');
  } finally {
    store.close();
  }

  const migrated = new DatabaseSync(storePath);
  try {
    const columns = migrated.prepare('PRAGMA table_info(tasks);').all() as ReadonlyArray<
      Record<string, unknown>
    >;
    const columnNames = columns.map((row) => String(row['name']));
    assert.equal(columnNames.includes('scope_kind'), true);
    assert.equal(columnNames.includes('project_id'), true);
    const indexes = migrated.prepare('PRAGMA index_list(tasks);').all() as ReadonlyArray<
      Record<string, unknown>
    >;
    assert.equal(
      indexes.some((row) => row['name'] === 'idx_tasks_scope_kind'),
      true,
    );
  } finally {
    migrated.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});
