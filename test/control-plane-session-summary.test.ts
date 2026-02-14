import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSessionSummaryList,
  parseSessionSummaryRecord
} from '../src/control-plane/session-summary.ts';

const validSummary = {
  sessionId: 'conversation-1',
  tenantId: 'tenant-local',
  userId: 'user-local',
  workspaceId: 'workspace-local',
  worktreeId: 'worktree-local',
  status: 'running',
  attentionReason: null,
  latestCursor: 12,
  attachedClients: 1,
  eventSubscribers: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  lastEventAt: '2026-01-01T00:01:00.000Z',
  lastExit: null,
  exitedAt: null,
  live: true
};

void test('parseSessionSummaryRecord accepts valid summary and nullable fields', () => {
  const parsed = parseSessionSummaryRecord(validSummary);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.sessionId, 'conversation-1');
  assert.equal(parsed?.live, true);

  const exited = parseSessionSummaryRecord({
    ...validSummary,
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
});

void test('parseSessionSummaryRecord rejects missing nullable fields when absent', () => {
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
