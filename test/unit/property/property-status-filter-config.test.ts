import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fc from 'fast-check';
import { parseHarnessConfigText } from '../../../src/config/config-core.ts';
import {
  eventIncludesRepositoryId,
  eventIncludesTaskId,
  matchesObservedFilter,
} from '../../../src/control-plane/stream-server-observed-filter.ts';
import type {
  StreamObservedEvent,
  StreamSessionStatusModel,
} from '../../../src/control-plane/stream-protocol.ts';
import { CodexStatusReducer } from '../../../src/control-plane/status/reducers/codex-status-reducer.ts';

const timestampArb = fc
  .integer({
    min: Date.parse('2020-01-01T00:00:00.000Z'),
    max: Date.parse('2030-12-31T23:59:59.999Z'),
  })
  .map((value) => new Date(value).toISOString());

const invalidTimestampArb = fc
  .string({ minLength: 0, maxLength: 32 })
  .filter((value) => !Number.isFinite(Date.parse(value)));

const observedEventArb: fc.Arbitrary<StreamObservedEvent> = fc.constantFrom(
  {
    type: 'session-output' as const,
    sessionId: 'conv-a',
    outputCursor: 1,
    chunkBase64: Buffer.from('x').toString('base64'),
    ts: '2026-02-18T00:00:00.000Z',
    directoryId: 'dir-a',
    conversationId: 'conv-a',
  },
  {
    type: 'task-created' as const,
    task: {
      taskId: 'task-a',
      repositoryId: 'repo-a',
    },
  },
  {
    type: 'task-reordered' as const,
    tasks: [
      {
        taskId: 'task-a',
        repositoryId: 'repo-a',
      },
      {
        taskId: 'task-b',
        repositoryId: 'repo-b',
      },
    ],
    ts: '2026-02-18T00:00:00.000Z',
  },
  {
    type: 'repository-updated' as const,
    repository: {
      repositoryId: 'repo-a',
    },
  },
);

interface FilterSeed {
  includeOutput: boolean;
  tenantId: 'tenant-a' | 'tenant-b' | undefined;
  userId: 'user-a' | 'user-b' | undefined;
  workspaceId: 'workspace-a' | 'workspace-b' | undefined;
  repositoryId: 'repo-a' | 'repo-b' | undefined;
  taskId: 'task-a' | 'task-b' | undefined;
  directoryId: 'dir-a' | 'dir-b' | undefined;
  conversationId: 'conv-a' | 'conv-b' | undefined;
}

interface FilterInput {
  includeOutput: boolean;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  taskId?: string;
  directoryId?: string;
  conversationId?: string;
}

function materializeFilter(seed: FilterSeed): FilterInput {
  const filter: FilterInput = {
    includeOutput: seed.includeOutput,
  };
  if (seed.tenantId !== undefined) {
    filter.tenantId = seed.tenantId;
  }
  if (seed.userId !== undefined) {
    filter.userId = seed.userId;
  }
  if (seed.workspaceId !== undefined) {
    filter.workspaceId = seed.workspaceId;
  }
  if (seed.repositoryId !== undefined) {
    filter.repositoryId = seed.repositoryId;
  }
  if (seed.taskId !== undefined) {
    filter.taskId = seed.taskId;
  }
  if (seed.directoryId !== undefined) {
    filter.directoryId = seed.directoryId;
  }
  if (seed.conversationId !== undefined) {
    filter.conversationId = seed.conversationId;
  }
  return filter;
}

const filterArb: fc.Arbitrary<FilterSeed> = fc.record({
  includeOutput: fc.boolean(),
  tenantId: fc.option(fc.constantFrom('tenant-a', 'tenant-b'), { nil: undefined }),
  userId: fc.option(fc.constantFrom('user-a', 'user-b'), { nil: undefined }),
  workspaceId: fc.option(fc.constantFrom('workspace-a', 'workspace-b'), { nil: undefined }),
  repositoryId: fc.option(fc.constantFrom('repo-a', 'repo-b'), { nil: undefined }),
  taskId: fc.option(fc.constantFrom('task-a', 'task-b'), { nil: undefined }),
  directoryId: fc.option(fc.constantFrom('dir-a', 'dir-b'), { nil: undefined }),
  conversationId: fc.option(fc.constantFrom('conv-a', 'conv-b'), { nil: undefined }),
});

const scopeArb = fc.record({
  tenantId: fc.constantFrom('tenant-a', 'tenant-b'),
  userId: fc.constantFrom('user-a', 'user-b'),
  workspaceId: fc.constantFrom('workspace-a', 'workspace-b'),
  directoryId: fc.constantFrom('dir-a', 'dir-b', null),
  conversationId: fc.constantFrom('conv-a', 'conv-b', null),
});

void test('property: codex reducer ignores invalid telemetry observedAt for work-state updates', () => {
  fc.assert(
    fc.property(
      timestampArb,
      timestampArb,
      invalidTimestampArb,
      (previousAt, observedAt, invalidTs) => {
        const reducer = new CodexStatusReducer();
        const previous: StreamSessionStatusModel = {
          runtimeStatus: 'running',
          phase: 'working',
          glyph: '◆',
          badge: 'RUN ',
          detailText: 'active',
          attentionReason: null,
          lastKnownWork: 'active',
          lastKnownWorkAt: previousAt,
          phaseHint: 'working',
          observedAt: previousAt,
        };
        const projected = reducer.project({
          runtimeStatus: 'running',
          attentionReason: null,
          telemetry: {
            source: 'otlp-log',
            eventName: 'codex.turn.e2e_duration_ms',
            severity: null,
            summary: null,
            observedAt: invalidTs,
          },
          observedAt,
          previous,
        });

        assert.notEqual(projected, null);
        if (projected === null) {
          return;
        }
        assert.equal(projected.lastKnownWork, previous.lastKnownWork);
        assert.equal(projected.lastKnownWorkAt, previous.lastKnownWorkAt);
        assert.equal(projected.phaseHint, previous.phaseHint);
      },
    ),
    { numRuns: 120 },
  );
});

void test('property: observed filter is monotonic when constraints are tightened', () => {
  fc.assert(
    fc.property(
      scopeArb,
      observedEventArb,
      filterArb,
      fc.constantFrom(
        'includeOutput',
        'tenantId',
        'userId',
        'workspaceId',
        'repositoryId',
        'taskId',
        'directoryId',
        'conversationId',
      ),
      (scope, event, baseSeed, tightenedField) => {
        const base = materializeFilter(baseSeed);
        const tightened = { ...base };
        if (tightenedField === 'includeOutput') {
          tightened.includeOutput = false;
        } else if (tightenedField === 'tenantId') {
          if (tightened.tenantId === undefined) {
            tightened.tenantId = 'tenant-a';
          }
        } else if (tightenedField === 'userId') {
          if (tightened.userId === undefined) {
            tightened.userId = 'user-a';
          }
        } else if (tightenedField === 'workspaceId') {
          if (tightened.workspaceId === undefined) {
            tightened.workspaceId = 'workspace-a';
          }
        } else if (tightenedField === 'repositoryId') {
          if (tightened.repositoryId === undefined) {
            tightened.repositoryId = 'repo-a';
          }
        } else if (tightenedField === 'taskId') {
          if (tightened.taskId === undefined) {
            tightened.taskId = 'task-a';
          }
        } else if (tightenedField === 'directoryId') {
          if (tightened.directoryId === undefined) {
            tightened.directoryId = 'dir-a';
          }
        } else if (tightened.conversationId === undefined) {
          tightened.conversationId = 'conv-a';
        }

        const ctx = {
          eventIncludesRepositoryId,
          eventIncludesTaskId,
        };
        const tightenedMatch = matchesObservedFilter(ctx, scope, event, tightened);
        if (!tightenedMatch) {
          return;
        }
        assert.equal(matchesObservedFilter(ctx, scope, event, base), true);
      },
    ),
    { numRuns: 200 },
  );
});

void test('property: parseHarnessConfigText normalization is idempotent for JSON inputs', () => {
  fc.assert(
    fc.property(fc.jsonValue(), (value) => {
      const normalized = parseHarnessConfigText(JSON.stringify(value));
      const reparsed = parseHarnessConfigText(JSON.stringify(normalized));
      assert.deepEqual(reparsed, normalized);
    }),
    { numRuns: 120 },
  );
});
