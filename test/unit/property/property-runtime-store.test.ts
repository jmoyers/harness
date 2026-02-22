import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fc from 'fast-check';
import { normalizeNanoTimestamp } from '../../../src/control-plane/codex-telemetry.ts';
import { notifyKeyEventFromPayload } from '../../../src/control-plane/stream-server-session-runtime.ts';
import type { NormalizedEventEnvelope } from '../../../src/events/normalized-events.ts';
import { SqliteEventStore } from '../../../src/store/event-store.ts';

const OBSERVED_AT = '2026-02-18T00:00:00.000Z';

function distortToken(
  token: string,
  casing: readonly boolean[],
  separators: readonly string[],
): string {
  let out = separators[0] ?? '';
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index] ?? '';
    out += casing[index] ? char.toUpperCase() : char.toLowerCase();
    out += separators[index + 1] ?? '';
  }
  return out;
}

const separatorArb = fc.constantFrom('', '-', '_', ' ', '.', ':', '!');

void test('property: claude notification token normalization is punctuation/case invariant', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('permissionrequest', 'approvalrequest', 'approvalrequired', 'inputrequired'),
      fc.array(fc.boolean(), { minLength: 13, maxLength: 20 }),
      fc.array(separatorArb, { minLength: 14, maxLength: 21 }),
      (canonical, casingSeed, separatorSeed) => {
        const casing = Array.from({ length: canonical.length }, (_, i) => casingSeed[i] ?? false);
        const separators = Array.from(
          { length: canonical.length + 1 },
          (_, i) => separatorSeed[i] ?? '',
        );
        const notificationType = distortToken(canonical, casing, separators);
        const keyEvent = notifyKeyEventFromPayload(
          'claude',
          {
            hook_event_name: 'notification',
            notification_type: notificationType,
          },
          OBSERVED_AT,
        );
        assert.notEqual(keyEvent, null);
        assert.equal(keyEvent?.statusHint, 'needs-input');
      },
    ),
    { numRuns: 90 },
  );

  fc.assert(
    fc.property(
      fc.constantFrom(
        'permissionapproved',
        'permissiongranted',
        'approvalapproved',
        'approvalgranted',
      ),
      fc.array(fc.boolean(), { minLength: 16, maxLength: 20 }),
      fc.array(separatorArb, { minLength: 17, maxLength: 21 }),
      (canonical, casingSeed, separatorSeed) => {
        const casing = Array.from({ length: canonical.length }, (_, i) => casingSeed[i] ?? false);
        const separators = Array.from(
          { length: canonical.length + 1 },
          (_, i) => separatorSeed[i] ?? '',
        );
        const notificationType = distortToken(canonical, casing, separators);
        const keyEvent = notifyKeyEventFromPayload(
          'claude',
          {
            hook_event_name: 'notification',
            notification_type: notificationType,
          },
          OBSERVED_AT,
        );
        assert.notEqual(keyEvent, null);
        assert.equal(keyEvent?.statusHint, 'running');
      },
    ),
    { numRuns: 90 },
  );
});

void test('property: codex turn-complete notify ignores surrounding whitespace', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 4 }), fc.string({ maxLength: 4 }), (prefix, suffix) => {
      const keyEvent = notifyKeyEventFromPayload(
        'codex',
        {
          type: `${prefix.replace(/[^\s]/g, ' ')}agent-turn-complete${suffix.replace(/[^\s]/g, ' ')}`,
        },
        OBSERVED_AT,
      );
      assert.notEqual(keyEvent, null);
      assert.equal(keyEvent?.statusHint, 'completed');
    }),
    { numRuns: 80 },
  );
});

void test('property: event store listEvents preserves tenant/user isolation and cursor monotonicity', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          tenantId: fc.constantFrom('tenant-a', 'tenant-b'),
          userId: fc.constantFrom('user-a', 'user-b'),
          workspaceId: fc.constantFrom('workspace-a', 'workspace-b'),
          worktreeId: fc.string({ minLength: 1, maxLength: 8 }),
          conversationId: fc.string({ minLength: 1, maxLength: 8 }),
          turnId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
          eventShape: fc.constantFrom<'provider-turn' | 'meta-queue'>(
            'provider-turn',
            'meta-queue',
          ),
        }),
        { minLength: 1, maxLength: 40 },
      ),
      fc.integer({ min: 0, max: 30 }),
      (seedEvents, pivotSeed) => {
        const store = new SqliteEventStore(':memory:');
        try {
          const events: NormalizedEventEnvelope[] = seedEvents.map((seed, index) => ({
            schemaVersion: '1',
            eventId: `event-${String(index)}`,
            source: seed.eventShape === 'provider-turn' ? 'provider' : 'meta',
            type:
              seed.eventShape === 'provider-turn' ? 'provider-turn-started' : 'meta-queue-updated',
            ts: `2026-02-18T00:00:${String(index).padStart(2, '0')}.000Z`,
            scope: {
              tenantId: seed.tenantId,
              userId: seed.userId,
              workspaceId: seed.workspaceId,
              worktreeId: seed.worktreeId,
              conversationId: seed.conversationId,
              ...(seed.turnId === undefined ? {} : { turnId: seed.turnId }),
            },
            payload:
              seed.eventShape === 'provider-turn'
                ? {
                    kind: 'turn',
                    threadId: seed.conversationId,
                    turnId: seed.turnId ?? `turn-${String(index)}`,
                    status: 'in-progress',
                  }
                : {
                    kind: 'queue',
                    queueSize: index,
                  },
          }));

          store.appendEvents(events);

          for (const tenantId of ['tenant-a', 'tenant-b'] as const) {
            for (const userId of ['user-a', 'user-b'] as const) {
              const listed = store.listEvents({
                tenantId,
                userId,
                limit: 200,
              });
              const expected = events.filter(
                (event) => event.scope.tenantId === tenantId && event.scope.userId === userId,
              );
              assert.deepEqual(
                listed.map((row) => row.event.eventId),
                expected.map((event) => event.eventId),
              );

              for (let i = 1; i < listed.length; i += 1) {
                assert.ok((listed[i - 1]?.rowId ?? 0) < (listed[i]?.rowId ?? 0));
              }

              if (listed.length > 0) {
                const pivot = pivotSeed % listed.length;
                const afterRowId = listed[pivot]?.rowId ?? 0;
                const tailed = store.listEvents({
                  tenantId,
                  userId,
                  afterRowId,
                  limit: 200,
                });
                assert.deepEqual(
                  tailed.map((row) => row.event.eventId),
                  listed.slice(pivot + 1).map((row) => row.event.eventId),
                );
              }
            }
          }
        } finally {
          store.close();
        }
      },
    ),
    { numRuns: 40 },
  );
});

const nonNumericSuffixArb = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((suffix) => suffix.trim().length > 0 && !/^\d+$/u.test(suffix.trim()));

void test('property: normalizeNanoTimestamp rejects strings with trailing non-digit characters', () => {
  const fallback = '2026-01-01T00:00:00.000Z';
  fc.assert(
    fc.property(
      fc.integer({ min: 1_000_000_000_000_000, max: 1_800_000_000_000_000_000 }),
      nonNumericSuffixArb,
      (nanoValue, suffix) => {
        const result = normalizeNanoTimestamp(`${String(nanoValue)}${suffix}`, fallback);
        assert.equal(result, fallback);
      },
    ),
    { numRuns: 300, seed: 1337 },
  );
});
