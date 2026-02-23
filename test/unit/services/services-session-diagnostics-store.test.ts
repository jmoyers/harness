import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  SESSION_DIAGNOSTICS_FILE_EXTENSION,
  SessionDiagnosticsStore,
} from '../../../src/services/session-diagnostics-store.ts';

void test('session diagnostics store records unsupported control sequence entries and status transitions', () => {
  const diagnosticsDirectory = mkdtempSync(
    join(tmpdir(), 'harness-session-diagnostics-store-records-'),
  );
  const store = new SessionDiagnosticsStore({
    maxEntriesPerConversation: 8,
    diagnosticsDirectory,
  });
  store.recordUnsupportedControlSequences({
    conversationId: 'conversation-a',
    observedAt: '2026-02-23T00:00:00.000Z',
    source: 'pty-output',
    cursor: 11,
    chunkPreview: '\\u001b[?1045h',
    issues: [
      {
        kind: 'unsupported-csi',
        offset: 0,
        sequence: '\u001b[?1045h',
        finalByte: 'h',
        rawParams: '?1045',
      },
      {
        kind: 'unsupported-c0',
        offset: 9,
        sequence: '\u0001',
      },
    ],
  });
  store.recordStatusTransition({
    conversationId: 'conversation-a',
    observedAt: '2026-02-23T00:00:01.000Z',
    source: 'control-plane-key:session-status',
    from: {
      status: 'running',
      attentionReason: null,
      live: true,
      phase: 'working',
      detailText: 'thinking',
      lastKnownWork: 'active',
      lastKnownWorkAt: '2026-02-23T00:00:00.500Z',
      telemetrySource: 'otlp-log',
    },
    to: {
      status: 'completed',
      attentionReason: null,
      live: false,
      phase: 'idle',
      detailText: 'completed',
      lastKnownWork: 'inactive',
      lastKnownWorkAt: '2026-02-23T00:00:01.000Z',
      telemetrySource: 'otlp-metric',
    },
    metadata: {
      cursor: 12,
    },
  });

  const entries = store.listConversationEntries('conversation-a');
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, 'unsupported-control-sequences');
  assert.equal(entries[1]?.kind, 'status-transition');
  if (entries[0]?.kind !== 'unsupported-control-sequences') {
    assert.fail('expected unsupported-control-sequences entry');
  }
  assert.equal(entries[0].issues.length, 2);
  assert.equal(entries[0].issues[1]?.sequencePreview, '\\u0001');
  const diagnosticsPath = join(
    diagnosticsDirectory,
    `conversation-a${SESSION_DIAGNOSTICS_FILE_EXTENSION}`,
  );
  assert.equal(existsSync(diagnosticsPath), true);
  const records = readFileSync(diagnosticsPath, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.conversationId, 'conversation-a');
  assert.equal(records[0]?.kind, 'unsupported-control-sequences');
  assert.equal(records[1]?.kind, 'status-transition');
  store.close();
});

void test('session diagnostics store keeps bounded history and clears per conversation', () => {
  const diagnosticsDirectory = mkdtempSync(
    join(tmpdir(), 'harness-session-diagnostics-store-clear-'),
  );
  const store = new SessionDiagnosticsStore({
    maxEntriesPerConversation: 2,
    diagnosticsDirectory,
  });
  store.recordStatusTransition({
    conversationId: 'conversation-b',
    observedAt: '2026-02-23T00:00:00.000Z',
    source: 'a',
    from: {
      status: 'running',
      attentionReason: null,
      live: true,
      phase: null,
      detailText: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      telemetrySource: null,
    },
    to: {
      status: 'running',
      attentionReason: null,
      live: true,
      phase: null,
      detailText: null,
      lastKnownWork: 'active',
      lastKnownWorkAt: '2026-02-23T00:00:00.000Z',
      telemetrySource: 'otlp-log',
    },
  });
  store.recordStatusTransition({
    conversationId: 'conversation-b',
    observedAt: '2026-02-23T00:00:01.000Z',
    source: 'b',
    from: {
      status: 'running',
      attentionReason: null,
      live: true,
      phase: null,
      detailText: null,
      lastKnownWork: 'active',
      lastKnownWorkAt: '2026-02-23T00:00:00.000Z',
      telemetrySource: 'otlp-log',
    },
    to: {
      status: 'needs-input',
      attentionReason: 'needs-input',
      live: true,
      phase: 'blocked',
      detailText: 'needs input',
      lastKnownWork: 'active',
      lastKnownWorkAt: '2026-02-23T00:00:01.000Z',
      telemetrySource: 'otlp-log',
    },
  });
  store.recordStatusTransition({
    conversationId: 'conversation-b',
    observedAt: '2026-02-23T00:00:02.000Z',
    source: 'c',
    from: {
      status: 'needs-input',
      attentionReason: 'needs-input',
      live: true,
      phase: 'blocked',
      detailText: 'needs input',
      lastKnownWork: 'active',
      lastKnownWorkAt: '2026-02-23T00:00:01.000Z',
      telemetrySource: 'otlp-log',
    },
    to: {
      status: 'completed',
      attentionReason: null,
      live: false,
      phase: 'idle',
      detailText: 'completed',
      lastKnownWork: 'inactive',
      lastKnownWorkAt: '2026-02-23T00:00:02.000Z',
      telemetrySource: 'otlp-metric',
    },
  });

  const bounded = store.listConversationEntries('conversation-b');
  assert.equal(bounded.length, 2);
  assert.equal(bounded[0]?.kind, 'status-transition');
  if (bounded[0]?.kind !== 'status-transition') {
    assert.fail('expected status-transition entry');
  }
  assert.equal(bounded[0].source, 'b');
  assert.equal(bounded[1]?.kind, 'status-transition');
  if (bounded[1]?.kind !== 'status-transition') {
    assert.fail('expected status-transition entry');
  }
  assert.equal(bounded[1].source, 'c');

  const diagnosticsPath = join(
    diagnosticsDirectory,
    `conversation-b${SESSION_DIAGNOSTICS_FILE_EXTENSION}`,
  );
  assert.equal(existsSync(diagnosticsPath), true);
  store.clearConversation('conversation-b');
  assert.deepEqual(store.listConversationEntries('conversation-b'), []);
  assert.equal(existsSync(diagnosticsPath), false);
  store.close();
});
