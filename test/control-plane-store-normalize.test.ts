import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  normalizeAutomationPolicyRow,
  normalizeProjectSettingsRow,
  normalizeTaskRow,
} from '../src/store/control-plane-store-normalize.ts';

function baseTaskRow(): Record<string, unknown> {
  return {
    task_id: 'task-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    workspace_id: 'workspace-1',
    repository_id: null,
    project_id: null,
    scope_kind: 'global',
    title: 'Task',
    description: '',
    status: 'ready',
    order_index: 0,
    claimed_by_controller_id: null,
    claimed_by_directory_id: null,
    branch_name: null,
    base_branch: null,
    claimed_at: null,
    completed_at: null,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  };
}

void test('task normalize derives scope from project/repository/global fallback when scope is malformed', () => {
  const projectScoped = normalizeTaskRow({
    ...baseTaskRow(),
    scope_kind: Buffer.from([1]),
    project_id: 'directory-1',
  });
  assert.equal(projectScoped.scopeKind, 'project');

  const repositoryScoped = normalizeTaskRow({
    ...baseTaskRow(),
    scope_kind: Buffer.from([1]),
    repository_id: 'repository-1',
  });
  assert.equal(repositoryScoped.scopeKind, 'repository');

  const globalScoped = normalizeTaskRow({
    ...baseTaskRow(),
    scope_kind: Buffer.from([1]),
  });
  assert.equal(globalScoped.scopeKind, 'global');
});

void test('task normalize rejects invalid explicit scope enum values', () => {
  assert.throws(
    () =>
      normalizeTaskRow({
        ...baseTaskRow(),
        scope_kind: 'invalid',
      }),
    /task scope enum value/,
  );
});

void test('project settings and automation policy normalization enforce enum values', () => {
  assert.throws(
    () =>
      normalizeProjectSettingsRow({
        directory_id: 'directory-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        pinned_branch: null,
        task_focus_mode: 'invalid',
        thread_spawn_mode: 'new-thread',
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      }),
    /project task focus enum value/,
  );
  assert.throws(
    () =>
      normalizeProjectSettingsRow({
        directory_id: 'directory-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        pinned_branch: null,
        task_focus_mode: 'balanced',
        thread_spawn_mode: 'invalid',
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      }),
    /thread spawn enum value/,
  );
  assert.throws(
    () =>
      normalizeAutomationPolicyRow({
        policy_id: 'policy-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        scope_type: 'invalid',
        scope_id: null,
        automation_enabled: 1,
        frozen: 0,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      }),
    /automation policy scope enum value/,
  );
});
