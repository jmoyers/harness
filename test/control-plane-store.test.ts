import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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
