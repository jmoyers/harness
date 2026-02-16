import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  parseSessionSummaryList,
  parseSessionSummaryRecord
} from '../src/control-plane/session-summary.ts';

const validSummary = {
  sessionId: 'conversation-1',
  directoryId: 'directory-1',
  tenantId: 'tenant-local',
  userId: 'user-local',
  workspaceId: 'workspace-local',
  worktreeId: 'worktree-local',
  status: 'running',
  attentionReason: null,
  latestCursor: 12,
  processId: 51000,
  attachedClients: 1,
  eventSubscribers: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  lastEventAt: '2026-01-01T00:01:00.000Z',
  lastExit: null,
  exitedAt: null,
  live: true,
  controller: null,
  telemetry: {
    source: 'otlp-log',
    eventName: 'codex.api_request',
    severity: 'INFO',
    summary: 'codex.api_request (ok)',
    observedAt: '2026-01-01T00:01:00.000Z'
  }
};

void test('parseSessionSummaryRecord accepts valid summary and nullable fields', () => {
  const parsed = parseSessionSummaryRecord(validSummary);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.sessionId, 'conversation-1');
  assert.equal(parsed?.directoryId, 'directory-1');
  assert.equal(parsed?.live, true);
  assert.equal(parsed?.processId, 51000);
  assert.equal(parsed?.telemetry?.source, 'otlp-log');

  const exited = parseSessionSummaryRecord({
    ...validSummary,
    directoryId: null,
    status: 'exited',
    live: false,
    attentionReason: 'approval',
    latestCursor: null,
    lastEventAt: null,
    lastExit: {
      code: null,
      signal: 'SIGTERM'
    },
    exitedAt: '2026-01-01T00:02:00.000Z'
  });
  assert.equal(exited?.status, 'exited');
  assert.equal(exited?.lastExit?.signal, 'SIGTERM');
  assert.equal(exited?.telemetry?.eventName, 'codex.api_request');

  const needsInput = parseSessionSummaryRecord({
    ...validSummary,
    status: 'needs-input'
  });
  assert.equal(needsInput?.status, 'needs-input');

  const completed = parseSessionSummaryRecord({
    ...validSummary,
    status: 'completed'
  });
  assert.equal(completed?.status, 'completed');

  const controlled = parseSessionSummaryRecord({
    ...validSummary,
    controller: {
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: 'agent one',
      claimedAt: '2026-01-01T00:01:30.000Z'
    }
  });
  assert.equal(controlled?.controller?.controllerId, 'agent-1');

  const withoutTelemetry = parseSessionSummaryRecord({
    ...validSummary,
    telemetry: null
  });
  assert.equal(withoutTelemetry?.telemetry, null);
});

void test('parseSessionSummaryRecord rejects malformed summaries', () => {
  assert.equal(parseSessionSummaryRecord(null), null);
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      status: 'bad'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      live: 'yes'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastExit: {
        code: 1,
        signal: 'NOPE'
      }
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      attentionReason: 123
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      latestCursor: '12'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastExit: 'bad'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastExit: {
        code: 1
      }
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastExit: {
        signal: null
      }
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      live: null
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      telemetry: {
        source: 'bad',
        eventName: null,
        severity: null,
        summary: null,
        observedAt: new Date(0).toISOString()
      }
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      telemetry: 'bad'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      controller: 'bad-controller'
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      controller: {
        controllerId: 'agent-1',
        controllerType: 'invalid',
        controllerLabel: 'agent one',
        claimedAt: new Date(0).toISOString()
      }
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      controller: {
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: 'agent one'
      }
    }),
    null
  );
});

void test('parseSessionSummaryRecord rejects missing nullable fields when absent', () => {
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      directoryId: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      attentionReason: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
    ...validSummary,
    latestCursor: undefined
  }),
  null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      processId: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastExit: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      attachedClients: null
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      eventSubscribers: null
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      startedAt: null
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      lastEventAt: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      exitedAt: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      telemetry: undefined
    }),
    null
  );
  assert.equal(
    parseSessionSummaryRecord({
      ...validSummary,
      controller: undefined
    }),
    null
  );
});

void test('parseSessionSummaryList filters invalid entries', () => {
  const parsed = parseSessionSummaryList([
    validSummary,
    {
      nope: true
    },
    {
      ...validSummary,
      sessionId: 'conversation-2'
    }
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.sessionId, 'conversation-1');
  assert.equal(parsed[1]?.sessionId, 'conversation-2');
  assert.deepEqual(parseSessionSummaryList('nope'), []);
});
