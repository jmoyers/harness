import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fc from 'fast-check';
import { parseStreamCommand } from '../src/control-plane/stream-command-parser.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  parseServerEnvelope,
  type StreamClientEnvelope,
  type StreamServerEnvelope,
} from '../src/control-plane/stream-protocol.ts';

const alphaNum = fc.string({ minLength: 1, maxLength: 24 });

function chunkBySizes(text: string, sizes: readonly number[]): readonly string[] {
  const parts: string[] = [];
  let offset = 0;
  let sizeIndex = 0;
  while (offset < text.length) {
    const requested = sizes[sizeIndex] ?? 1;
    const size = Math.max(1, requested % 17);
    parts.push(text.slice(offset, offset + size));
    offset += size;
    sizeIndex += 1;
  }
  return parts;
}

const taskListStatusArb = fc.constantFrom('draft', 'ready', 'queued', 'in-progress', 'completed');
const taskListScopeArb = fc.constantFrom('global', 'repository', 'project');

void test('property: parseStreamCommand task.list normalization stays canonical', () => {
  fc.assert(
    fc.property(
      fc.record({
        tenantId: fc.option(alphaNum, { nil: undefined }),
        userId: fc.option(alphaNum, { nil: undefined }),
        workspaceId: fc.option(alphaNum, { nil: undefined }),
        repositoryId: fc.option(alphaNum, { nil: undefined }),
        projectId: fc.option(alphaNum, { nil: undefined }),
        scopeKind: fc.option(taskListScopeArb, { nil: undefined }),
        status: fc.option(taskListStatusArb, { nil: undefined }),
        limit: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
      }),
      (optionalFields) => {
        const parsed = parseStreamCommand({
          type: 'task.list',
          ...optionalFields,
        });
        assert.notEqual(parsed, null);
        if (parsed === null) {
          return;
        }
        assert.equal(parsed.type, 'task.list');
        if (optionalFields.status === 'queued') {
          assert.equal(parsed.status, 'ready');
        } else {
          assert.equal(parsed.status, optionalFields.status);
        }
        assert.deepEqual(parseStreamCommand(parsed), parsed);
      },
    ),
    { numRuns: 120 },
  );
});

void test('property: parseStreamCommand rejects invalid task.list status and scope', () => {
  fc.assert(
    fc.property(
      alphaNum.filter(
        (value) =>
          value !== 'draft' &&
          value !== 'ready' &&
          value !== 'queued' &&
          value !== 'in-progress' &&
          value !== 'completed',
      ),
      alphaNum.filter(
        (value) => value !== 'global' && value !== 'repository' && value !== 'project',
      ),
      (invalidStatus, invalidScope) => {
        assert.equal(
          parseStreamCommand({
            type: 'task.list',
            status: invalidStatus,
          }),
          null,
        );
        assert.equal(
          parseStreamCommand({
            type: 'task.list',
            scopeKind: invalidScope,
          }),
          null,
        );
      },
    ),
    { numRuns: 80 },
  );
});

void test('property: parseStreamCommand task.create linear priority bounds enforced', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 4 }), (priority) => {
      const parsed = parseStreamCommand({
        type: 'task.create',
        title: 'x',
        linear: { priority },
      });
      assert.notEqual(parsed, null);
      if (parsed !== null && parsed.type === 'task.create') {
        assert.equal(parsed.linear?.priority, priority);
      }
    }),
    { numRuns: 60 },
  );

  fc.assert(
    fc.property(
      fc.oneof(fc.integer({ min: -1_000, max: -1 }), fc.integer({ min: 5, max: 1_000 })),
      (priority) => {
        assert.equal(
          parseStreamCommand({
            type: 'task.create',
            title: 'x',
            linear: { priority },
          }),
          null,
        );
      },
    ),
    { numRuns: 60 },
  );
});

const clientEnvelopeArb: fc.Arbitrary<StreamClientEnvelope> = fc.oneof(
  fc.record({ kind: fc.constant('auth' as const), token: alphaNum }),
  fc.record({
    kind: fc.constant('pty.input' as const),
    sessionId: alphaNum,
    dataBase64: fc.base64String(),
  }),
  fc.record({
    kind: fc.constant('pty.resize' as const),
    sessionId: alphaNum,
    cols: fc.integer({ min: 1, max: 400 }),
    rows: fc.integer({ min: 1, max: 200 }),
  }),
  fc.record({
    kind: fc.constant('pty.signal' as const),
    sessionId: alphaNum,
    signal: fc.constantFrom('interrupt', 'eof', 'terminate'),
  }),
  fc.record({
    kind: fc.constant('command' as const),
    commandId: alphaNum,
    command: fc.constantFrom(
      { type: 'session.list' as const },
      { type: 'attention.list' as const },
      { type: 'repository.get' as const, repositoryId: 'repo-1' },
      { type: 'task.get' as const, taskId: 'task-1' },
    ),
  }),
);

const serverEnvelopeArb: fc.Arbitrary<StreamServerEnvelope> = fc.oneof(
  fc.constant({ kind: 'auth.ok' as const }),
  fc.record({ kind: fc.constant('auth.error' as const), error: alphaNum }),
  fc.record({ kind: fc.constant('command.accepted' as const), commandId: alphaNum }),
  fc.record({ kind: fc.constant('command.failed' as const), commandId: alphaNum, error: alphaNum }),
  fc.record({
    kind: fc.constant('command.completed' as const),
    commandId: alphaNum,
    result: fc.dictionary(alphaNum, fc.oneof(alphaNum, fc.integer({ min: 0, max: 100 }))),
  }),
  fc.record({
    kind: fc.constant('pty.output' as const),
    sessionId: alphaNum,
    cursor: fc.integer({ min: 0, max: 100000 }),
    chunkBase64: fc.base64String(),
  }),
  fc.record({
    kind: fc.constant('pty.exit' as const),
    sessionId: alphaNum,
    exit: fc.record({
      code: fc.option(fc.integer({ min: 0, max: 255 }), { nil: null }),
      signal: fc.constant(null),
    }),
  }),
  fc.record({
    kind: fc.constant('pty.event' as const),
    sessionId: alphaNum,
    event: fc.record({
      type: fc.constant('notify' as const),
      record: fc.record({
        ts: fc.constant('2026-02-18T00:00:00.000Z'),
        payload: fc.dictionary(alphaNum, alphaNum),
      }),
    }),
  }),
);

void test('property: stream protocol framing survives arbitrary chunk boundaries', () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(clientEnvelopeArb, serverEnvelopeArb), { minLength: 1, maxLength: 40 }),
      fc.array(fc.integer({ min: 1, max: 64 }), { minLength: 1, maxLength: 120 }),
      (envelopes, chunkSizes) => {
        const encoded = envelopes.map((envelope) => encodeStreamEnvelope(envelope)).join('');
        const chunks = chunkBySizes(encoded, chunkSizes);
        let remainder = '';
        const decoded: unknown[] = [];

        for (const chunk of chunks) {
          const consumed = consumeJsonLines(remainder + chunk);
          decoded.push(...consumed.messages);
          remainder = consumed.remainder;
        }

        assert.equal(remainder, '');
        assert.deepEqual(decoded, envelopes);
      },
    ),
    { numRuns: 90 },
  );
});

void test('property: parseClientEnvelope and parseServerEnvelope round-trip encoded records', () => {
  fc.assert(
    fc.property(clientEnvelopeArb, (envelope) => {
      const reparsed = parseClientEnvelope(JSON.parse(encodeStreamEnvelope(envelope).trim()));
      assert.deepEqual(reparsed, envelope);
    }),
    { numRuns: 120 },
  );

  fc.assert(
    fc.property(serverEnvelopeArb, (envelope) => {
      const reparsed = parseServerEnvelope(JSON.parse(encodeStreamEnvelope(envelope).trim()));
      assert.deepEqual(reparsed, envelope);
    }),
    { numRuns: 120 },
  );
});
