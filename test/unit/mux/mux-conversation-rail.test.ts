import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildConversationRailLines,
  compareIsoDesc,
  cycleConversationId,
  renderConversationRailAnsiRows,
  sortConversationRailSessions,
  type ConversationRailSessionSummary,
} from '../../../src/mux/conversation-rail.ts';
import { statusModelFor } from '../../support/status-model.ts';

function withStatusModel(
  session: Omit<ConversationRailSessionSummary, 'statusModel'>,
): ConversationRailSessionSummary {
  return {
    ...session,
    statusModel: statusModelFor(session.status, {
      attentionReason: session.attentionReason,
      observedAt: session.lastEventAt ?? session.startedAt,
    }),
  };
}

function withStatusModels(
  sessions: readonly Omit<ConversationRailSessionSummary, 'statusModel'>[],
): readonly ConversationRailSessionSummary[] {
  return sessions.map((session) => withStatusModel(session));
}

const sessions: readonly ConversationRailSessionSummary[] = withStatusModels([
  {
    sessionId: 'conversation-cccccccc-0000',
    status: 'completed',
    attentionReason: null,
    live: true,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T00:03:00.000Z',
  },
  {
    sessionId: 'conversation-aaaaaaaa-0000',
    status: 'needs-input',
    attentionReason: 'approval',
    live: true,
    startedAt: '2026-01-01T00:01:00.000Z',
    lastEventAt: '2026-01-01T00:05:00.000Z',
  },
  {
    sessionId: 'conversation-bbbbbbbb-0000',
    status: 'running',
    attentionReason: null,
    live: true,
    startedAt: '2026-01-01T00:02:00.000Z',
    lastEventAt: '2026-01-01T00:04:00.000Z',
  },
  {
    sessionId: 'external-session-with-very-long-id-123456',
    status: 'exited',
    attentionReason: null,
    live: false,
    startedAt: '2026-01-01T00:02:00.000Z',
    lastEventAt: null,
  },
]);

void test('sortConversationRailSessions honors attention-first and started sorts', () => {
  const attentionSorted = sortConversationRailSessions(sessions, 'attention-first');
  assert.deepEqual(
    attentionSorted.map((session) => session.sessionId),
    [
      'conversation-aaaaaaaa-0000',
      'conversation-bbbbbbbb-0000',
      'conversation-cccccccc-0000',
      'external-session-with-very-long-id-123456',
    ],
  );

  const startedDesc = sortConversationRailSessions(sessions, 'started-desc');
  assert.deepEqual(
    startedDesc.map((session) => session.sessionId),
    [
      'conversation-bbbbbbbb-0000',
      'external-session-with-very-long-id-123456',
      'conversation-aaaaaaaa-0000',
      'conversation-cccccccc-0000',
    ],
  );

  const startedAsc = sortConversationRailSessions(sessions, 'started-asc');
  assert.deepEqual(
    startedAsc.map((session) => session.sessionId),
    [
      'conversation-cccccccc-0000',
      'conversation-aaaaaaaa-0000',
      'conversation-bbbbbbbb-0000',
      'external-session-with-very-long-id-123456',
    ],
  );
});

void test('buildConversationRailLines renders header, active marker, and truncation', () => {
  const lines = buildConversationRailLines(sessions, 'conversation-bbbbbbbb-0000', 48, 3);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.includes('conversations (4)'), true);
  assert.equal(lines[1]?.includes('[!] aaaaaaaa - approval'), true);
  assert.equal(lines[2]?.startsWith('> [~] bbbbbbbb'), true);

  const hiddenActive = buildConversationRailLines(
    sessions,
    'external-session-with-very-long-id-123456',
    48,
    3,
  );
  assert.equal(hiddenActive.length, 3);
  assert.equal(hiddenActive[2]?.includes('external-session…'), true);

  const missingActive = buildConversationRailLines(sessions, 'missing-session', 48, 3);
  assert.equal(missingActive.length, 3);
  assert.equal(missingActive[2]?.includes('bbbbbbbb'), true);

  const padded = buildConversationRailLines([], null, 8, 4);
  assert.equal(padded.length, 4);
  assert.equal(padded[3], '        ');

  const oneRow = buildConversationRailLines(sessions, null, 10, 1);
  assert.equal(oneRow.length, 1);
  assert.equal(oneRow[0]?.length, 10);

  const completedVisible = buildConversationRailLines(sessions, null, 60, 6);
  assert.equal(
    completedVisible.some((line) => line.includes('[+] cccccccc')),
    true,
  );
  assert.equal(
    completedVisible.some((line) => line.includes('[x] external-session…')),
    true,
  );

  const shortConversationId = buildConversationRailLines(
    [
      withStatusModel({
        sessionId: 'conversation-12345678',
        status: 'running',
        attentionReason: null,
        live: true,
        startedAt: '2026-01-01T00:01:00.000Z',
        lastEventAt: '2026-01-01T00:01:00.000Z',
      }),
    ],
    'conversation-12345678',
    48,
    3,
  );
  assert.equal(shortConversationId[1]?.includes('[~] 12345678'), true);

  const emptyAttentionReason = buildConversationRailLines(
    [
      withStatusModel({
        sessionId: 'conversation-empty-reason',
        status: 'needs-input',
        attentionReason: '',
        live: true,
        startedAt: '2026-01-01T00:01:00.000Z',
        lastEventAt: '2026-01-01T00:01:00.000Z',
      }),
    ],
    'conversation-empty-reason',
    48,
    2,
  );
  assert.equal(emptyAttentionReason[1]?.includes('empty-re'), true);
  assert.equal(emptyAttentionReason[1]?.trimEnd().endsWith('[!] empty-re'), true);
});

void test('cycleConversationId wraps and handles missing active session', () => {
  const ids = ['a', 'b', 'c'] as const;
  assert.equal(cycleConversationId(ids, 'a', 'next'), 'b');
  assert.equal(cycleConversationId(ids, 'a', 'previous'), 'c');
  assert.equal(cycleConversationId(ids, null, 'next'), 'a');
  assert.equal(cycleConversationId(ids, 'missing', 'next'), 'a');
  assert.equal(cycleConversationId([], null, 'next'), null);
});

void test('attention-first sort handles last-event and started/id tie-breakers', () => {
  const tieRows: readonly ConversationRailSessionSummary[] = withStatusModels([
    {
      sessionId: 'short-id',
      status: 'running',
      attentionReason: null,
      live: true,
      startedAt: '2026-01-01T00:01:00.000Z',
      lastEventAt: null,
    },
    {
      sessionId: 'session-b',
      status: 'running',
      attentionReason: null,
      live: true,
      startedAt: '2026-01-01T00:03:00.000Z',
      lastEventAt: '2026-01-01T00:05:00.000Z',
    },
    {
      sessionId: 'session-a',
      status: 'running',
      attentionReason: null,
      live: true,
      startedAt: '2026-01-01T00:03:00.000Z',
      lastEventAt: '2026-01-01T00:05:00.000Z',
    },
  ]);

  const sorted = sortConversationRailSessions(tieRows, 'attention-first');
  assert.deepEqual(
    sorted.map((row) => row.sessionId),
    ['session-a', 'session-b', 'short-id'],
  );

  const rendered = buildConversationRailLines(tieRows, 'short-id', 32, 5);
  assert.equal(rendered[1]?.includes('session-a'), true);
  assert.equal(rendered[2]?.includes('session-b'), true);
  assert.equal(rendered[3]?.includes('short-id'), true);

  const byStartedDescFallback = sortConversationRailSessions(
    [
      withStatusModel({
        sessionId: 'id-2',
        status: 'running',
        attentionReason: null,
        live: true,
        startedAt: '2026-01-01T00:01:00.000Z',
        lastEventAt: '2026-01-01T00:01:00.000Z',
      }),
      withStatusModel({
        sessionId: 'id-1',
        status: 'running',
        attentionReason: null,
        live: true,
        startedAt: '2026-01-01T00:02:00.000Z',
        lastEventAt: '2026-01-01T00:01:00.000Z',
      }),
    ],
    'attention-first',
  );
  assert.deepEqual(
    byStartedDescFallback.map((row) => row.sessionId),
    ['id-1', 'id-2'],
  );
});

void test('buildConversationRailLines supports stable input order mode', () => {
  const inputOrdered = buildConversationRailLines(
    sessions,
    'conversation-cccccccc-0000',
    48,
    5,
    'input-order',
  );
  assert.equal(inputOrdered[1]?.includes('cccccccc'), true);
  assert.equal(inputOrdered[2]?.includes('aaaaaaaa'), true);
  assert.equal(inputOrdered[3]?.includes('bbbbbbbb'), true);
});

void test('attention-first sort covers null and non-null lastEvent comparator branches', () => {
  const rows: readonly ConversationRailSessionSummary[] = withStatusModels([
    {
      sessionId: 'left-null',
      status: 'running',
      attentionReason: null,
      live: true,
      startedAt: '2026-01-01T00:01:00.000Z',
      lastEventAt: null,
    },
    {
      sessionId: 'right-non-null',
      status: 'running',
      attentionReason: null,
      live: true,
      startedAt: '2026-01-01T00:01:00.000Z',
      lastEventAt: '2026-01-01T00:05:00.000Z',
    },
  ]);

  const nullCompared = sortConversationRailSessions(rows, 'attention-first');
  assert.deepEqual(
    nullCompared.map((row) => row.sessionId),
    ['right-non-null', 'left-null'],
  );

  const localeCompared = sortConversationRailSessions(
    [
      withStatusModel({
        sessionId: 'event-b',
        status: 'running',
        attentionReason: null,
        live: true,
        startedAt: '2026-01-01T00:01:00.000Z',
        lastEventAt: '2026-01-01T00:05:00.000Z',
      }),
      withStatusModel({
        sessionId: 'event-a',
        status: 'running',
        attentionReason: null,
        live: true,
        startedAt: '2026-01-01T00:01:00.000Z',
        lastEventAt: '2026-01-01T00:04:00.000Z',
      }),
    ],
    'attention-first',
  );
  assert.deepEqual(
    localeCompared.map((row) => row.sessionId),
    ['event-b', 'event-a'],
  );
});

void test('compareIsoDesc handles null and lexicographic ordering', () => {
  assert.equal(compareIsoDesc(null, null), 0);
  assert.equal(compareIsoDesc(null, '2026-01-01T00:00:00.000Z'), 1);
  assert.equal(compareIsoDesc('2026-01-01T00:00:00.000Z', null), -1);
  assert.equal(compareIsoDesc('2026-01-01T00:04:00.000Z', '2026-01-01T00:05:00.000Z'), 1);
  assert.equal(compareIsoDesc('2026-01-01T00:05:00.000Z', '2026-01-01T00:04:00.000Z'), -1);
});

void test('renderConversationRailAnsiRows paints header, badges, and active-row highlight', () => {
  const ansiRows = renderConversationRailAnsiRows(
    sessions,
    'conversation-bbbbbbbb-0000',
    48,
    6,
    'input-order',
  );
  assert.equal(ansiRows.length, 6);
  assert.equal(ansiRows[0]?.includes('\u001b[0;38;5;250;48;5;236m'), true);
  assert.equal(ansiRows[2]?.includes('\u001b[0;1;38;5;231;48;5;166m'), true);
  assert.equal(ansiRows[3]?.includes('\u001b[0;38;5;255;48;5;238m'), true);
  assert.equal(ansiRows[3]?.includes('\u001b[0;1;38;5;231;48;5;238m'), true);
  assert.equal(ansiRows[4]?.includes('\u001b[0;38;5;245;49m'), true);
  assert.equal(ansiRows[4]?.includes('external-session… (dead)'), true);
});
