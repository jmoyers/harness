import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from '../src/store/sqlite.ts';
import {
  SqliteControlPlaneStore,
  normalizeStoredConversationRow,
  normalizeStoredDirectoryRow
} from '../src/store/control-plane-store.ts';

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-control-plane-store-'));
  return join(dir, 'control-plane.sqlite');
}

void test('control-plane store upserts directories and persists conversations/runtime', () => {
  const storePath = tempStorePath();
  const store = new SqliteControlPlaneStore(storePath);
  try {
    const directory = store.upsertDirectory({
      directoryId: 'dir-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: '/tmp/workspace-1'
    });
    assert.equal(directory.directoryId, 'dir-1');
    assert.equal(directory.archivedAt, null);

    const sameDirectory = store.upsertDirectory({
      directoryId: 'dir-ignored',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: '/tmp/workspace-1'
    });
    assert.equal(sameDirectory.directoryId, 'dir-1');

    const conversation = store.createConversation({
      conversationId: 'conversation-1',
      directoryId: 'dir-1',
      title: 'untitled task 1',
      agentType: 'codex'
    });
    assert.equal(conversation.conversationId, 'conversation-1');
    assert.equal(conversation.runtimeStatus, 'running');
    assert.equal(conversation.runtimeLive, false);
    assert.deepEqual(conversation.adapterState, {});

    const updatedAdapterState = store.updateConversationAdapterState('conversation-1', {
      codex: {
        resumeSessionId: 'thread-123'
      }
    });
    assert.deepEqual(updatedAdapterState?.adapterState, {
      codex: {
        resumeSessionId: 'thread-123'
      }
    });
    const updatedTitle = store.updateConversationTitle('conversation-1', 'renamed task');
    assert.equal(updatedTitle?.title, 'renamed task');

    const runtimeUpdated = store.updateConversationRuntime('conversation-1', {
      status: 'needs-input',
      live: true,
      attentionReason: 'approval',
      processId: 73001,
      lastEventAt: '2026-02-14T00:00:00.000Z',
      lastExit: null
    });
    assert.equal(runtimeUpdated?.runtimeStatus, 'needs-input');
    assert.equal(runtimeUpdated?.runtimeLive, true);
    assert.equal(runtimeUpdated?.runtimeAttentionReason, 'approval');
    assert.equal(runtimeUpdated?.runtimeProcessId, 73001);

    const runtimeExited = store.updateConversationRuntime('conversation-1', {
      status: 'exited',
      live: false,
      attentionReason: null,
      processId: null,
      lastEventAt: '2026-02-14T00:01:00.000Z',
      lastExit: {
        code: 130,
        signal: 'SIGINT'
      }
    });
    assert.equal(runtimeExited?.runtimeLastExit?.signal, 'SIGINT');
    assert.equal(runtimeExited?.runtimeLastExit?.code, 130);

    const listedDirectories = store.listDirectories({
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      limit: 10
    });
    assert.equal(listedDirectories.length, 1);
    assert.equal(store.listDirectories({}).length, 1);
    assert.equal(store.listDirectories({ includeArchived: true }).length, 1);
    const archivedDirectory = store.archiveDirectory('dir-1');
    assert.notEqual(archivedDirectory.archivedAt, null);
    assert.equal(store.listDirectories({}).length, 0);
    assert.equal(store.listDirectories({ includeArchived: true }).length, 1);
    const archivedDirectoryAgain = store.archiveDirectory('dir-1');
    assert.equal(archivedDirectoryAgain.directoryId, 'dir-1');
    assert.equal(archivedDirectoryAgain.archivedAt, archivedDirectory.archivedAt);
    store.upsertDirectory({
      directoryId: 'dir-restore',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: '/tmp/workspace-1'
    });
    assert.equal(store.listDirectories({}).length, 1);

    const listedConversations = store.listConversations({
      directoryId: 'dir-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      limit: 10
    });
    assert.equal(listedConversations.length, 1);
    assert.equal(listedConversations[0]?.conversationId, 'conversation-1');
    assert.equal(store.listConversations({ includeArchived: true }).length, 1);

    const archived = store.archiveConversation('conversation-1');
    assert.notEqual(archived.archivedAt, null);
    assert.equal(store.listConversations({ directoryId: 'dir-1' }).length, 0);
    assert.equal(
      store.listConversations({
        directoryId: 'dir-1',
        includeArchived: true
      }).length,
      1
    );
  } finally {
    store.close();
  }

  const reopened = new SqliteControlPlaneStore(storePath);
  try {
    const persistedDirectory = reopened.getDirectory('dir-1');
    const persistedConversation = reopened.getConversation('conversation-1');
    assert.equal(persistedDirectory?.path, '/tmp/workspace-1');
    assert.equal(persistedConversation?.runtimeStatus, 'exited');
    assert.equal(persistedConversation?.runtimeLastExit?.signal, 'SIGINT');
    assert.deepEqual(persistedConversation?.adapterState, {
      codex: {
        resumeSessionId: 'thread-123'
      }
    });
  } finally {
    reopened.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});

void test('control-plane store restores archived directory and validates errors', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const dir = store.upsertDirectory({
      directoryId: 'dir-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      path: '/tmp/dir-a'
    });
    assert.equal(dir.directoryId, 'dir-a');

    const conversation = store.createConversation({
      conversationId: 'conversation-a',
      directoryId: 'dir-a',
      title: 'untitled task a',
      agentType: 'codex'
    });
    assert.equal(conversation.runtimeLive, false);

    store.archiveConversation('conversation-a');
    assert.throws(
      () =>
        store.createConversation({
          conversationId: 'conversation-a',
          directoryId: 'dir-a',
          title: 'dup',
          agentType: 'codex'
        }),
      /conversation already exists/
    );
    assert.throws(
      () =>
        store.archiveConversation('missing-conversation'),
      /conversation not found/
    );
    assert.equal(store.updateConversationRuntime('missing-conversation', {
      status: 'running',
      live: true,
      attentionReason: null,
      processId: null,
      lastEventAt: null,
      lastExit: null
    }), null);
    assert.equal(
      store.updateConversationAdapterState('missing-conversation', {
        codex: {
          resumeSessionId: 'thread-missing'
        }
      }),
      null
    );
    assert.equal(store.updateConversationTitle('missing-conversation', 'x'), null);

    store.archiveDirectory('dir-a');

    const restored = store.upsertDirectory({
      directoryId: 'dir-new',
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      path: '/tmp/dir-a'
    });
    assert.equal(restored.directoryId, 'dir-a');
    assert.equal(restored.archivedAt, null);

    store.archiveDirectory('dir-a');
    assert.throws(
      () =>
        store.createConversation({
          conversationId: 'conversation-archived-directory',
          directoryId: 'dir-a',
          title: 't',
          agentType: 'codex'
        }),
      /directory not found/
    );

    assert.throws(
      () =>
        store.archiveDirectory('missing-directory'),
      /directory not found/
    );
    assert.throws(
      () =>
        store.createConversation({
          conversationId: 'conversation-b',
          directoryId: 'missing-directory',
          title: 't',
          agentType: 'codex'
        }),
      /directory not found/
    );
  } finally {
    store.close();
  }
});

void test('control-plane store upsertDirectory updates existing id paths and rejects scope mismatch', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const created = store.upsertDirectory({
      directoryId: 'dir-update',
      tenantId: 'tenant-update',
      userId: 'user-update',
      workspaceId: 'workspace-update',
      path: '/tmp/update-a'
    });
    assert.equal(created.path, '/tmp/update-a');
    assert.equal(created.archivedAt, null);

    const unchanged = store.upsertDirectory({
      directoryId: 'dir-update',
      tenantId: 'tenant-update',
      userId: 'user-update',
      workspaceId: 'workspace-update',
      path: '/tmp/update-a'
    });
    assert.equal(unchanged.directoryId, 'dir-update');
    assert.equal(unchanged.path, '/tmp/update-a');

    const moved = store.upsertDirectory({
      directoryId: 'dir-update',
      tenantId: 'tenant-update',
      userId: 'user-update',
      workspaceId: 'workspace-update',
      path: '/tmp/update-b'
    });
    assert.equal(moved.directoryId, 'dir-update');
    assert.equal(moved.path, '/tmp/update-b');
    assert.equal(moved.archivedAt, null);

    store.archiveDirectory('dir-update');
    const restoredSameId = store.upsertDirectory({
      directoryId: 'dir-update',
      tenantId: 'tenant-update',
      userId: 'user-update',
      workspaceId: 'workspace-update',
      path: '/tmp/update-b'
    });
    assert.equal(restoredSameId.archivedAt, null);

    assert.throws(
      () =>
        store.upsertDirectory({
          directoryId: 'dir-update',
          tenantId: 'tenant-other',
          userId: 'user-update',
          workspaceId: 'workspace-update',
          path: '/tmp/update-c'
        }),
      /directory scope mismatch/
    );
  } finally {
    store.close();
  }
});

void test('control-plane store persists telemetry, deduplicates fingerprints, and resolves thread mapping', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    store.upsertDirectory({
      directoryId: 'dir-telemetry',
      tenantId: 'tenant-telemetry',
      userId: 'user-telemetry',
      workspaceId: 'workspace-telemetry',
      path: '/tmp/telemetry'
    });
    store.createConversation({
      conversationId: 'conversation-telemetry',
      directoryId: 'dir-telemetry',
      title: 'telemetry conversation',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-telemetry'
        }
      }
    });

    const insertedFirst = store.appendTelemetry({
      source: 'otlp-log',
      sessionId: 'conversation-telemetry',
      providerThreadId: 'thread-telemetry',
      eventName: 'codex.user_prompt',
      severity: 'INFO',
      summary: 'prompt accepted',
      observedAt: '2026-02-15T00:00:00.000Z',
      payload: {
        a: 1
      },
      fingerprint: 'fingerprint-1'
    });
    const insertedDuplicate = store.appendTelemetry({
      source: 'otlp-log',
      sessionId: 'conversation-telemetry',
      providerThreadId: 'thread-telemetry',
      eventName: 'codex.user_prompt',
      severity: 'INFO',
      summary: 'prompt accepted',
      observedAt: '2026-02-15T00:00:00.000Z',
      payload: {
        a: 1
      },
      fingerprint: 'fingerprint-1'
    });
    assert.equal(insertedFirst, true);
    assert.equal(insertedDuplicate, false);

    store.appendTelemetry({
      source: 'history',
      sessionId: 'conversation-telemetry',
      providerThreadId: 'thread-telemetry',
      eventName: 'history.entry',
      severity: null,
      summary: 'from history',
      observedAt: '2026-02-15T00:00:01.000Z',
      payload: {
        b: 2
      },
      fingerprint: 'fingerprint-2'
    });

    const latest = store.latestTelemetrySummary('conversation-telemetry');
    assert.deepEqual(latest, {
      source: 'history',
      eventName: 'history.entry',
      severity: null,
      summary: 'from history',
      observedAt: '2026-02-15T00:00:01.000Z'
    });

    const listed = store.listTelemetryForSession('conversation-telemetry', 10);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.summary, 'from history');
    assert.equal(listed[1]?.summary, 'prompt accepted');
    assert.equal(typeof listed[0]?.telemetryId, 'number');
    assert.equal(listed[0]?.payload['b'], 2);
    assert.equal(listed[1]?.fingerprint, 'fingerprint-1');

    assert.equal(
      store.findConversationIdByCodexThreadId('thread-telemetry'),
      'conversation-telemetry'
    );
    store.archiveConversation('conversation-telemetry');
    assert.equal(store.findConversationIdByCodexThreadId('thread-telemetry'), null);
    assert.equal(store.findConversationIdByCodexThreadId('missing-thread'), null);
    assert.equal(store.findConversationIdByCodexThreadId('   '), null);
    assert.equal(store.latestTelemetrySummary('missing-conversation'), null);
    assert.deepEqual(store.listTelemetryForSession('missing-conversation', 5), []);
  } finally {
    store.close();
  }
});

void test('control-plane telemetry append returns false when sqlite run result is non-object', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  const internals = store as unknown as {
    db: {
      prepare: (sql: string) => {
        run: (...args: unknown[]) => unknown;
      };
    };
  };
  const originalPrepare = internals.db.prepare.bind(internals.db);
  internals.db.prepare = ((sql: string) => {
    if (sql.includes('INSERT INTO session_telemetry')) {
      return {
        run: () => null
      };
    }
    return originalPrepare(sql);
  }) as typeof internals.db.prepare;
  try {
    const inserted = store.appendTelemetry({
      source: 'otlp-log',
      sessionId: 'conversation-non-object-result',
      providerThreadId: null,
      eventName: 'event',
      severity: null,
      summary: null,
      observedAt: '2026-02-15T00:00:00.000Z',
      payload: {},
      fingerprint: 'fingerprint-non-object-result'
    });
    assert.equal(inserted, false);
  } finally {
    store.close();
  }
});

void test('control-plane telemetry append returns false when sqlite run changes is non-numeric', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  const internals = store as unknown as {
    db: {
      prepare: (sql: string) => {
        run: (...args: unknown[]) => unknown;
      };
    };
  };
  const originalPrepare = internals.db.prepare.bind(internals.db);
  internals.db.prepare = ((sql: string) => {
    if (sql.includes('INSERT INTO session_telemetry')) {
      return {
        run: () => ({ changes: 'bad-value' })
      };
    }
    return originalPrepare(sql);
  }) as typeof internals.db.prepare;
  try {
    const inserted = store.appendTelemetry({
      source: 'otlp-log',
      sessionId: 'conversation-non-numeric-changes',
      providerThreadId: null,
      eventName: 'event',
      severity: null,
      summary: null,
      observedAt: '2026-02-15T00:00:00.000Z',
      payload: {},
      fingerprint: 'fingerprint-non-numeric-changes'
    });
    assert.equal(inserted, false);
  } finally {
    store.close();
  }
});

void test('control-plane store normalization helpers validate row shapes and fields', () => {
  assert.throws(() => normalizeStoredDirectoryRow(null), /expected object row/);
  assert.throws(
    () =>
      normalizeStoredDirectoryRow({
        directory_id: 1
      }),
    /expected string for directory_id/
  );

  assert.throws(() => normalizeStoredConversationRow(null), /expected object row/);
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'invalid-status',
        runtime_live: 0,
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /runtime_status enum/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 2,
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /unexpected flag value/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 1,
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: null
      }),
    /adapter_state_json/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 'true',
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /integer flag/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 1.5,
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /integer flag/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 1,
        runtime_attention_reason: null,
        runtime_process_id: 'x',
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /finite number/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 1,
        runtime_attention_reason: null,
        runtime_process_id: Infinity,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: null,
        adapter_state_json: '{}'
      }),
    /finite number/
  );
  assert.throws(
    () =>
      normalizeStoredConversationRow({
        conversation_id: 'c',
        directory_id: 'd',
        tenant_id: 't',
        user_id: 'u',
        workspace_id: 'w',
        title: 'title',
        agent_type: 'codex',
        created_at: '2026-02-14T00:00:00.000Z',
        archived_at: null,
        runtime_status: 'running',
        runtime_live: 1,
        runtime_attention_reason: null,
        runtime_process_id: null,
        runtime_last_event_at: null,
        runtime_last_exit_code: null,
        runtime_last_exit_signal: 'BROKEN',
        adapter_state_json: '{}'
      }),
    /signal name/
  );
  const normalizedSignalOnly = normalizeStoredConversationRow({
    conversation_id: 'c-signal',
    directory_id: 'd',
    tenant_id: 't',
    user_id: 'u',
    workspace_id: 'w',
    title: 'title',
    agent_type: 'codex',
    created_at: '2026-02-14T00:00:00.000Z',
    archived_at: null,
    runtime_status: 'running',
    runtime_live: 1,
    runtime_attention_reason: null,
    runtime_process_id: null,
    runtime_last_event_at: null,
    runtime_last_exit_code: null,
    runtime_last_exit_signal: 'SIGTERM',
    adapter_state_json: '{"codex":{"resumeSessionId":"thread-1"}}'
  });
  assert.equal(normalizedSignalOnly.runtimeLastExit?.code, null);
  assert.equal(normalizedSignalOnly.runtimeLastExit?.signal, 'SIGTERM');
  assert.deepEqual(normalizedSignalOnly.adapterState, {
    codex: {
      resumeSessionId: 'thread-1'
    }
  });

  const normalizedCodeOnly = normalizeStoredConversationRow({
    conversation_id: 'c-code',
    directory_id: 'd',
    tenant_id: 't',
    user_id: 'u',
    workspace_id: 'w',
    title: 'title',
    agent_type: 'codex',
    created_at: '2026-02-14T00:00:00.000Z',
    archived_at: null,
    runtime_status: 'running',
    runtime_live: 1,
    runtime_attention_reason: null,
    runtime_process_id: null,
    runtime_last_event_at: null,
    runtime_last_exit_code: 130,
    runtime_last_exit_signal: null,
    adapter_state_json: '[]'
  });
  assert.equal(normalizedCodeOnly.runtimeLastExit?.code, 130);
  assert.equal(normalizedCodeOnly.runtimeLastExit?.signal, null);
  assert.deepEqual(normalizedCodeOnly.adapterState, {});

  const normalizedInvalidAdapterState = normalizeStoredConversationRow({
    conversation_id: 'c-invalid-adapter',
    directory_id: 'd',
    tenant_id: 't',
    user_id: 'u',
    workspace_id: 'w',
    title: 'title',
    agent_type: 'codex',
    created_at: '2026-02-14T00:00:00.000Z',
    archived_at: null,
    runtime_status: 'running',
    runtime_live: 1,
    runtime_attention_reason: null,
    runtime_process_id: null,
    runtime_last_event_at: null,
    runtime_last_exit_code: null,
    runtime_last_exit_signal: null,
    adapter_state_json: '{bad json'
  });
  assert.deepEqual(normalizedInvalidAdapterState.adapterState, {});
});

void test('control-plane telemetry normalization guards reject invalid rows and fallback on malformed payload json', () => {
  const storePath = tempStorePath();
  const store = new SqliteControlPlaneStore(storePath);
  store.close();

  const db = new DatabaseSync(storePath);
  try {
    db.exec(`
      INSERT INTO session_telemetry (
        source,
        session_id,
        provider_thread_id,
        event_name,
        severity,
        summary,
        observed_at,
        ingested_at,
        payload_json,
        fingerprint
      ) VALUES (
        'bad-source',
        'conversation-x',
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-15T00:00:00.000Z',
        '2026-02-15T00:00:00.000Z',
        '{}',
        'bad-source-row'
      );
    `);
  } finally {
    db.close();
  }

  const reopened = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(() => reopened.listTelemetryForSession('conversation-x', 10), /telemetry source enum value/);
  } finally {
    reopened.close();
  }

  const db2 = new DatabaseSync(storePath);
  try {
    db2.exec(`DELETE FROM session_telemetry;`);
    db2.exec(`
      INSERT INTO session_telemetry (
        source,
        session_id,
        provider_thread_id,
        event_name,
        severity,
        summary,
        observed_at,
        ingested_at,
        payload_json,
        fingerprint
      ) VALUES (
        'otlp-log',
        'conversation-y',
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-15T00:00:00.000Z',
        '2026-02-15T00:00:00.000Z',
        '[]',
        'array-payload-row'
      );
    `);
    db2.exec(`
      INSERT INTO session_telemetry (
        source,
        session_id,
        provider_thread_id,
        event_name,
        severity,
        summary,
        observed_at,
        ingested_at,
        payload_json,
        fingerprint
      ) VALUES (
        'otlp-log',
        'conversation-y',
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-15T00:00:01.000Z',
        '2026-02-15T00:00:01.000Z',
        '{',
        'bad-json-row'
      );
    `);
    db2.exec(`
      INSERT INTO session_telemetry (
        source,
        session_id,
        provider_thread_id,
        event_name,
        severity,
        summary,
        observed_at,
        ingested_at,
        payload_json,
        fingerprint
      ) VALUES (
        'otlp-log',
        'conversation-y',
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-02-15T00:00:02.000Z',
        '2026-02-15T00:00:02.000Z',
        zeroblob(1),
        'blob-payload-row'
      );
    `);
  } finally {
    db2.close();
  }

  const reopenedPayload = new SqliteControlPlaneStore(storePath);
  try {
    assert.throws(
      () => reopenedPayload.listTelemetryForSession('conversation-y', 10),
      /expected string for payload_json/
    );
  } finally {
    reopenedPayload.close();
  }

  const db3 = new DatabaseSync(storePath);
  try {
    db3.exec(`DELETE FROM session_telemetry WHERE fingerprint = 'blob-payload-row';`);
  } finally {
    db3.close();
  }

  const reopenedPayloadFallback = new SqliteControlPlaneStore(storePath);
  try {
    const rows = reopenedPayloadFallback.listTelemetryForSession('conversation-y', 10);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]?.payload, {});
    assert.deepEqual(rows[1]?.payload, {});
  } finally {
    reopenedPayloadFallback.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});

void test('control-plane store thread-id lookup falls back when json_extract path raises', () => {
  const storePath = tempStorePath();
  const store = new SqliteControlPlaneStore(storePath);
  try {
    store.upsertDirectory({
      directoryId: 'dir-fallback',
      tenantId: 'tenant-fallback',
      userId: 'user-fallback',
      workspaceId: 'workspace-fallback',
      path: '/tmp/fallback'
    });
    store.createConversation({
      conversationId: 'conversation-bad-json',
      directoryId: 'dir-fallback',
      title: 'bad json',
      agentType: 'codex',
      adapterState: {}
    });
    store.createConversation({
      conversationId: 'conversation-good-json',
      directoryId: 'dir-fallback',
      title: 'good json',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-fallback'
        }
      }
    });
  } finally {
    store.close();
  }

  const db = new DatabaseSync(storePath);
  try {
    db.prepare('UPDATE conversations SET adapter_state_json = ? WHERE conversation_id = ?').run(
      '{',
      'conversation-bad-json'
    );
    db.prepare('UPDATE conversations SET adapter_state_json = ? WHERE conversation_id = ?').run(
      '{"codex":"not-object"}',
      'conversation-good-json'
    );
  } finally {
    db.close();
  }

  const reopened = new SqliteControlPlaneStore(storePath);
  try {
    assert.equal(reopened.findConversationIdByCodexThreadId('thread-fallback'), null);
    reopened.updateConversationAdapterState('conversation-good-json', {
      codex: {
        resumeSessionId: 'thread-fallback'
      }
    });
    assert.equal(
      reopened.findConversationIdByCodexThreadId('thread-fallback'),
      'conversation-good-json'
    );
  } finally {
    reopened.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});

void test('control-plane store thread-id lookup supports legacy codex.threadId adapter state', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    store.upsertDirectory({
      directoryId: 'directory-legacy-thread-id',
      tenantId: 'tenant-legacy-thread-id',
      userId: 'user-legacy-thread-id',
      workspaceId: 'workspace-legacy-thread-id',
      path: '/tmp/legacy-thread-id'
    });
    store.createConversation({
      conversationId: 'conversation-legacy-thread-id',
      directoryId: 'directory-legacy-thread-id',
      title: 'legacy thread',
      agentType: 'codex',
      adapterState: {
        codex: {
          threadId: 'thread-legacy-id'
        }
      }
    });

    assert.equal(
      store.findConversationIdByCodexThreadId('thread-legacy-id'),
      'conversation-legacy-thread-id'
    );
  } finally {
    store.close();
  }
});

void test('control-plane store supports deleting conversations and rejects missing ids', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const directory = store.upsertDirectory({
      directoryId: 'directory-delete',
      tenantId: 'tenant-delete',
      userId: 'user-delete',
      workspaceId: 'workspace-delete',
      path: '/tmp/delete'
    });
    assert.equal(directory.directoryId, 'directory-delete');

    const created = store.createConversation({
      conversationId: 'conversation-delete',
      directoryId: directory.directoryId,
      title: 'delete me',
      agentType: 'codex'
    });
    assert.equal(created.conversationId, 'conversation-delete');
    assert.equal(store.deleteConversation('conversation-delete'), true);
    assert.equal(store.getConversation('conversation-delete'), null);
    assert.throws(() => store.deleteConversation('missing-conversation'), /conversation not found/);
  } finally {
    store.close();
  }
});

void test('control-plane store rollback guards cover impossible post-write null checks', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const originalGetDirectory = store.getDirectory.bind(store);
    const originalGetConversation = store.getConversation.bind(store);
    const internals = store as unknown as {
      db: {
        prepare: (sql: string) => { run: (...args: Array<number | string | null>) => void };
      };
    };

    store.getDirectory = (() => null) as typeof store.getDirectory;
    assert.throws(
      () =>
        store.upsertDirectory({
          directoryId: 'dir-rollback',
          tenantId: 'tenant-rollback',
          userId: 'user-rollback',
          workspaceId: 'workspace-rollback',
          path: '/tmp/rollback-directory'
        }),
      /directory insert failed/
    );

    store.getDirectory = originalGetDirectory;
    store.upsertDirectory({
      directoryId: 'dir-update-fail',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      path: '/tmp/update-fail-old'
    });
    let updateFailGetDirectoryCalls = 0;
    store.getDirectory = ((directoryId: string) => {
      if (directoryId === 'dir-update-fail') {
        updateFailGetDirectoryCalls += 1;
        if (updateFailGetDirectoryCalls >= 2) {
          return null;
        }
      }
      return originalGetDirectory(directoryId);
    }) as typeof store.getDirectory;
    assert.throws(
      () =>
        store.upsertDirectory({
          directoryId: 'dir-update-fail',
          tenantId: 'tenant-live',
          userId: 'user-live',
          workspaceId: 'workspace-live',
          path: '/tmp/update-fail-new'
        }),
      /directory missing after update/
    );

    store.getDirectory = originalGetDirectory;
    store.upsertDirectory({
      directoryId: 'dir-restore-fail',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      path: '/tmp/restore-fail'
    });
    internals.db.prepare('UPDATE directories SET archived_at = ? WHERE directory_id = ?').run(
      '2026-02-14T00:03:00.000Z',
      'dir-restore-fail'
    );
    store.getDirectory = ((directoryId: string) => {
      if (directoryId === 'dir-restore-fail') {
        return null;
      }
      return originalGetDirectory(directoryId);
    }) as typeof store.getDirectory;
    assert.throws(
      () =>
        store.upsertDirectory({
          directoryId: 'dir-restore-fail-new',
          tenantId: 'tenant-live',
          userId: 'user-live',
          workspaceId: 'workspace-live',
          path: '/tmp/restore-fail'
        }),
      /directory missing after restore/
    );

    store.getDirectory = originalGetDirectory;
    store.upsertDirectory({
      directoryId: 'dir-live',
      tenantId: 'tenant-live',
      userId: 'user-live',
      workspaceId: 'workspace-live',
      path: '/tmp/live-directory'
    });

    store.getConversation = (() => null) as typeof store.getConversation;
    assert.throws(
      () =>
        store.createConversation({
          conversationId: 'conversation-rollback',
          directoryId: 'dir-live',
          title: 'rollback conversation',
          agentType: 'codex'
        }),
      /conversation insert failed/
    );
    assert.equal(store.listConversations({ directoryId: 'dir-live' }).length, 0);
    store.getConversation = originalGetConversation;

    const created = store.createConversation({
      conversationId: 'conversation-live',
      directoryId: 'dir-live',
      title: 'live conversation',
      agentType: 'codex'
    });
    assert.equal(created.conversationId, 'conversation-live');

    let getConversationCallCount = 0;
    store.getConversation = ((conversationId: string) => {
      getConversationCallCount += 1;
      if (getConversationCallCount >= 2) {
        return null;
      }
      return originalGetConversation(conversationId);
    }) as typeof store.getConversation;
    assert.throws(
      () => store.archiveConversation('conversation-live'),
      /conversation missing after archive/
    );

    store.getConversation = originalGetConversation;
    const stillPresent = store.getConversation('conversation-live');
    assert.notEqual(stillPresent, null);
    assert.equal(stillPresent?.archivedAt, null);

    let getDirectoryCallCount = 0;
    store.getDirectory = ((directoryId: string) => {
      getDirectoryCallCount += 1;
      if (directoryId === 'dir-live' && getDirectoryCallCount >= 2) {
        return null;
      }
      return originalGetDirectory(directoryId);
    }) as typeof store.getDirectory;
    assert.throws(
      () => store.archiveDirectory('dir-live'),
      /directory missing after archive/
    );
  } finally {
    store.close();
  }
});

void test('control-plane store migrates legacy conversations schema to add adapter state column', () => {
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
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY,
        directory_id TEXT NOT NULL REFERENCES directories(directory_id),
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        runtime_status TEXT NOT NULL,
        runtime_live INTEGER NOT NULL,
        runtime_attention_reason TEXT,
        runtime_process_id INTEGER,
        runtime_last_event_at TEXT,
        runtime_last_exit_code INTEGER,
        runtime_last_exit_signal TEXT
      );
    `);
  } finally {
    legacy.close();
  }

  const store = new SqliteControlPlaneStore(storePath);
  try {
    const directory = store.upsertDirectory({
      directoryId: 'dir-legacy',
      tenantId: 'tenant-legacy',
      userId: 'user-legacy',
      workspaceId: 'workspace-legacy',
      path: '/tmp/legacy'
    });
    assert.equal(directory.directoryId, 'dir-legacy');
    const conversation = store.createConversation({
      conversationId: 'conversation-legacy',
      directoryId: 'dir-legacy',
      title: 'legacy upgrade',
      agentType: 'codex'
    });
    assert.deepEqual(conversation.adapterState, {});
  } finally {
    store.close();
    rmSync(storePath, { force: true });
    rmSync(dirname(storePath), { recursive: true, force: true });
  }
});


void test('control-plane store manages repositories and task lifecycle', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    store.upsertDirectory({
      directoryId: 'dir-task-a',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      path: '/tmp/task-a'
    });
    store.upsertDirectory({
      directoryId: 'dir-task-b',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      path: '/tmp/task-b'
    });
    store.upsertDirectory({
      directoryId: 'dir-task-other',
      tenantId: 'tenant-other',
      userId: 'user-other',
      workspaceId: 'workspace-other',
      path: '/tmp/task-other'
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
        provider: 'github'
      }
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
        provider: 'github'
      }
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
        owner: 'jmoyers'
      }
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
        owner: 'jmoyers'
      }
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
        owner: 'jmoyers'
      }
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
          remoteUrl: 'https://github.com/jmoyers/harness.git'
        }),
      /scope mismatch/
    );
    assert.throws(() => store.archiveRepository('missing-repository'), /repository not found/);

    assert.equal(store.updateRepository('missing-repository', { name: 'x' }), null);

    const updateRepositoryFull = store.updateRepository('repo-1', {
      name: 'Harness Final',
      remoteUrl: 'https://github.com/jmoyers/harness-final.git',
      defaultBranch: 'release',
      metadata: {
        tier: 'critical'
      }
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
      remoteUrl: 'https://github.com/jmoyers/repo-2.git'
    });
    store.upsertRepository({
      repositoryId: 'repo-other-scope',
      tenantId: 'tenant-other',
      userId: 'user-other',
      workspaceId: 'workspace-other',
      name: 'Repo Other Scope',
      remoteUrl: 'https://github.com/jmoyers/repo-other.git'
    });

    const taskA = store.createTask({
      taskId: 'task-a',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      title: 'task a'
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
        labelIds: ['bug', 'backend']
      }
    });
    const taskC = store.createTask({
      taskId: 'task-c',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      repositoryId: 'repo-2',
      title: 'task c'
    });
    assert.equal(taskA.orderIndex, 0);
    assert.equal(taskB.orderIndex, 1);
    assert.equal(taskC.orderIndex, 2);
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
          title: 'duplicate'
        }),
      /task already exists/
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-blank',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          title: '  '
        }),
      /expected non-empty title/
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-missing-repository',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          repositoryId: 'missing-repository',
          title: 'bad'
        }),
      /repository not found/
    );
    assert.throws(
      () =>
        store.createTask({
          taskId: 'task-repository-scope-mismatch',
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          repositoryId: 'repo-other-scope',
          title: 'bad'
        }),
      /scope mismatch/
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
            priority: 7
          }
        }),
      /linear\.priority/
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
            dueDate: '03-01-2026'
          }
        }),
      /YYYY-MM-DD/
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
            estimate: -1
          }
        }),
      /linear\.estimate/
    );

    const taskLinearNullLabels = store.createTask({
      taskId: 'task-linear-null-labels',
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      title: 'null labels',
      linear: {
        labelIds: null
      }
    });
    assert.deepEqual(taskLinearNullLabels.linear.labelIds, []);

    assert.equal(store.getTask('missing-task'), null);
    assert.equal(store.listTasks().length, 4);
    assert.equal(
      store.listTasks({
        tenantId: 'tenant-task',
        userId: 'user-task',
        workspaceId: 'workspace-task'
      }).length,
      4
    );
    assert.equal(store.listTasks({ repositoryId: 'repo-1' }).length, 1);
    assert.equal(store.listTasks({ status: 'draft' }).length, 4);

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
        labelIds: ['feature']
      }
    });
    assert.equal(updateTaskFull?.title, 'task a updated');
    assert.equal(updateTaskFull?.repositoryId, 'repo-1');
    assert.equal(updateTaskFull?.linear.identifier, 'ENG-43');
    assert.equal(updateTaskFull?.linear.priority, 1);
    assert.deepEqual(updateTaskFull?.linear.labelIds, ['feature']);

    const updateTaskNoop = store.updateTask('task-a', {
      title: 'task a renamed only'
    });
    assert.equal(updateTaskNoop?.title, 'task a renamed only');

    const updateTaskClearRepository = store.updateTask('task-a', {
      repositoryId: null
    });
    assert.equal(updateTaskClearRepository?.repositoryId, null);
    const updateTaskResetLinear = store.updateTask('task-a', {
      linear: null
    });
    assert.equal(updateTaskResetLinear?.linear.issueId, null);
    assert.equal(updateTaskResetLinear?.linear.priority, null);
    assert.deepEqual(updateTaskResetLinear?.linear.labelIds, []);

    assert.throws(
      () =>
        store.updateTask('task-a', {
          repositoryId: 'missing-repository'
        }),
      /repository not found/
    );
    assert.throws(
      () =>
        store.updateTask('task-a', {
          repositoryId: 'repo-other-scope'
        }),
      /scope mismatch/
    );
    assert.throws(
      () =>
        store.updateTask('task-a', {
          linear: {
            labelIds: ['ok', '  ']
          }
        }),
      /linear\.labelIds/
    );

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'missing-task',
          controllerId: 'agent-1'
        }),
      /task not found/
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: '   '
        }),
      /expected non-empty controllerId/
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-b',
          controllerId: 'agent-1'
        }),
      /cannot claim draft task/
    );

    const readyTaskA = store.readyTask('task-a');
    assert.equal(readyTaskA.status, 'ready');

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-1',
          directoryId: 'missing-directory'
        }),
      /directory not found/
    );
    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-1',
          directoryId: 'dir-task-other'
        }),
      /scope mismatch/
    );

    const claimedTaskA = store.claimTask({
      taskId: 'task-a',
      controllerId: 'agent-1',
      directoryId: 'dir-task-a',
      branchName: 'feature/task-a',
      baseBranch: 'main'
    });
    assert.equal(claimedTaskA.status, 'in-progress');
    assert.equal(claimedTaskA.claimedByControllerId, 'agent-1');
    assert.equal(claimedTaskA.claimedByDirectoryId, 'dir-task-a');
    assert.equal(claimedTaskA.branchName, 'feature/task-a');
    assert.equal(claimedTaskA.baseBranch, 'main');

    const completedTaskA = store.completeTask('task-a');
    assert.equal(completedTaskA.status, 'completed');
    assert.notEqual(completedTaskA.completedAt, null);

    const completedTaskAAgain = store.completeTask('task-a');
    assert.equal(completedTaskAAgain.status, 'completed');

    assert.throws(
      () =>
        store.claimTask({
          taskId: 'task-a',
          controllerId: 'agent-2'
        }),
      /cannot claim completed task/
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
      controllerId: 'agent-3'
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
          controllerId: 'agent-4'
        }),
      /cannot claim draft task/
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
          orderedTaskIds: ['task-c', 'task-c']
        }),
      /duplicate ids/
    );
    assert.throws(
      () =>
        store.reorderTasks({
          tenantId: 'tenant-task',
          userId: 'user-task',
          workspaceId: 'workspace-task',
          orderedTaskIds: ['missing-task']
        }),
      /not found in scope/
    );

    const reordered = store.reorderTasks({
      tenantId: 'tenant-task',
      userId: 'user-task',
      workspaceId: 'workspace-task',
      orderedTaskIds: ['task-c', 'task-a', '   ']
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
      remoteUrl: 'https://github.com/jmoyers/normalize.git'
    });
    store.createTask({
      taskId: 'task-normalize',
      tenantId: 'tenant-normalize',
      userId: 'user-normalize',
      workspaceId: 'workspace-normalize',
      repositoryId: 'repo-normalize',
      title: 'normalize task'
    });
  } finally {
    store.close();
  }

  const db = new DatabaseSync(storePath);
  try {
    db.prepare('UPDATE repositories SET metadata_json = ? WHERE repository_id = ?').run(
      '[]',
      'repo-normalize'
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
      /metadata_json/
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
    assert.throws(
      () => reopenedInvalidTaskRows.getTask('task-invalid-status'),
      /task status enum/
    );
    assert.throws(
      () => reopenedInvalidTaskRows.getTask('task-invalid-order-index'),
      /finite number/
    );
    assert.throws(
      () => reopenedInvalidTaskRows.getTask('task-invalid-linear-priority'),
      /linear\.priority/
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
          remoteUrl: 'https://github.com/jmoyers/repo-insert-fail.git'
        }),
      /repository insert failed/
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-update-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'update fail',
      remoteUrl: 'https://github.com/jmoyers/repo-update-fail.git'
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
          remoteUrl: 'https://github.com/jmoyers/repo-update-fail.git'
        }),
      /missing after update/
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-restore-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'restore fail',
      remoteUrl: 'https://github.com/jmoyers/repo-restore-fail.git'
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
          remoteUrl: 'https://github.com/jmoyers/repo-restore-fail.git'
        }),
      /missing after restore/
    );
    store.getRepository = originalGetRepository;

    store.upsertRepository({
      repositoryId: 'repo-archive-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      name: 'archive fail',
      remoteUrl: 'https://github.com/jmoyers/repo-archive-fail.git'
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
          title: 'insert fail'
        }),
      /task insert failed/
    );
    store.getTask = originalGetTask;

    store.upsertDirectory({
      directoryId: 'dir-rollback',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      path: '/tmp/dir-rollback'
    });

    store.createTask({
      taskId: 'task-claim-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'claim fail'
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
          directoryId: 'dir-rollback'
        }),
      /missing after claim/
    );
    store.getTask = originalGetTask;

    store.createTask({
      taskId: 'task-complete-fail',
      tenantId: 'tenant-rollback',
      userId: 'user-rollback',
      workspaceId: 'workspace-rollback',
      title: 'complete fail'
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
      title: 'queue fail'
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
      title: 'draft fail'
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
