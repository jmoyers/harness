import assert from 'node:assert/strict';
import { test } from 'bun:test';
import fc from 'fast-check';
import { TaskManager } from '../../../src/domain/tasks.ts';
import { detectMuxGlobalShortcut, resolveMuxShortcutBindings } from '../../../src/mux/input-shortcuts.ts';
import {
  buildLeftNavSelectorEntries,
  buildSelectorIndexEntries,
  visualConversationOrder,
} from '../../../src/mux/selector-index.ts';

interface TestTask {
  taskId: string;
  status: 'draft' | 'ready' | 'completed';
  order: number;
  repositoryId: string | null;
}

const idArb = fc.string({ minLength: 1, maxLength: 12 });

void test('property: TaskManager reorder results are permutation-preserving for active tasks', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.record({
          taskId: idArb,
          status: fc.constantFrom('draft', 'ready'),
          repositoryId: fc.option(idArb, { nil: null }),
        }),
        { minLength: 2, maxLength: 12, selector: (task) => task.taskId },
      ),
      fc.integer({ min: 0, max: 11 }),
      fc.integer({ min: 0, max: 11 }),
      (seedTasks, fromSeed, toSeed) => {
        const manager = new TaskManager<TestTask, { text: string }, { id: string }>();
        const tasks = seedTasks.map((task, index) => ({ ...task, order: index }));
        for (const task of tasks) {
          manager.setTask(task);
        }

        const sortByOrder = (list: readonly TestTask[]) =>
          [...list].sort((a, b) => a.order - b.order);
        const orderedIds = manager.orderedTasks(sortByOrder).map((task) => task.taskId);
        const fromIndex = fromSeed % orderedIds.length;
        const toIndex = toSeed % orderedIds.length;
        if (fromIndex === toIndex) {
          return;
        }

        const result = manager.reorderedActiveTaskIdsForDrop({
          draggedTaskId: orderedIds[fromIndex]!,
          targetTaskId: orderedIds[toIndex]!,
          sortTasks: sortByOrder,
          isCompleted: (task) => task.status === 'completed',
        });

        assert.notEqual(result, null);
        assert.notEqual(result, 'cannot-reorder-completed');
        if (Array.isArray(result)) {
          assert.equal(result.length, orderedIds.length);
          assert.deepEqual([...new Set(result)].sort(), [...orderedIds].sort());
        }
      },
    ),
    { numRuns: 120 },
  );
});

void test('property: taskReorderPayloadIds appends completed tasks after active ordering', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.record({
          taskId: idArb,
          status: fc.constantFrom('draft', 'ready', 'completed'),
          repositoryId: fc.option(idArb, { nil: null }),
        }),
        { minLength: 1, maxLength: 16, selector: (task) => task.taskId },
      ),
      (seedTasks) => {
        const manager = new TaskManager<TestTask, { text: string }, { id: string }>();
        const tasks = seedTasks.map((task, index) => ({ ...task, order: index }));
        for (const task of tasks) {
          manager.setTask(task);
        }

        const sortByOrder = (list: readonly TestTask[]) =>
          [...list].sort((a, b) => a.order - b.order);
        const ordered = manager.orderedTasks(sortByOrder);
        const activeIds = ordered
          .filter((task) => task.status !== 'completed')
          .map((task) => task.taskId);
        const completedIds = ordered
          .filter((task) => task.status === 'completed')
          .map((task) => task.taskId);

        const payload = manager.taskReorderPayloadIds({
          orderedActiveTaskIds: activeIds,
          sortTasks: sortByOrder,
          isCompleted: (task) => task.status === 'completed',
        });

        assert.deepEqual(payload, [...activeIds, ...completedIds]);
      },
    ),
    { numRuns: 120 },
  );
});

function normalizeDirectoryId(directoryId: string | null): string {
  if (directoryId === null) {
    return 'directory-missing';
  }
  const trimmed = directoryId.trim();
  return trimmed.length === 0 ? 'directory-missing' : trimmed;
}

void test('property: selector index output keeps unique sessions and contiguous selectors', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(idArb, { minLength: 0, maxLength: 8 }),
      fc.uniqueArray(
        fc.record({
          sessionId: idArb,
          directoryId: fc.option(fc.string({ minLength: 0, maxLength: 8 }), { nil: null }),
          title: fc.string({ minLength: 0, maxLength: 24 }),
          agentType: fc.constantFrom('codex', 'claude', 'cursor', 'terminal', 'critique'),
        }),
        { minLength: 0, maxLength: 20, selector: (conversation) => conversation.sessionId },
      ),
      fc.uniqueArray(idArb, { minLength: 0, maxLength: 24 }),
      (directoryIds, conversations, extraOrderedIds) => {
        const directories = new Map(directoryIds.map((id) => [id, { directoryId: id }]));
        const conversationMap = new Map(
          conversations.map((conversation) => [conversation.sessionId, conversation]),
        );
        const orderedSessionIds = [
          ...new Set([
            ...extraOrderedIds,
            ...conversations.map((conversation) => conversation.sessionId),
          ]),
        ];

        const entries = buildSelectorIndexEntries(directories, conversationMap, orderedSessionIds);
        assert.deepEqual(
          entries.map((entry) => entry.selectorIndex),
          entries.map((_, index) => index + 1),
        );

        const uniqueEntrySessions = new Set(entries.map((entry) => entry.sessionId));
        assert.equal(uniqueEntrySessions.size, entries.length);

        const expectedOrderedKnown = orderedSessionIds.filter((id) => conversationMap.has(id));
        assert.deepEqual(
          entries.map((entry) => entry.sessionId).sort(),
          [...expectedOrderedKnown].sort(),
        );

        for (const entry of entries) {
          const conversation = conversationMap.get(entry.sessionId);
          assert.notEqual(conversation, undefined);
          assert.equal(entry.directoryId, normalizeDirectoryId(conversation?.directoryId ?? null));
        }

        assert.deepEqual(
          visualConversationOrder(directories, conversationMap, orderedSessionIds),
          entries.map((entry) => entry.sessionId),
        );

        const leftNav = buildLeftNavSelectorEntries(
          directories,
          conversationMap,
          orderedSessionIds,
          {
            includeHome: true,
          },
        );
        assert.equal(leftNav[0]?.kind, 'home');
        assert.deepEqual(
          leftNav.map((entry) => entry.selectorIndex),
          leftNav.map((_, index) => index + 1),
        );
      },
    ),
    { numRuns: 100 },
  );
});

void test('property: shortcut decoder accepts equivalent ctrl encodings', () => {
  const safeCtrlLetters = ['a', 'b', 'd', 'e', 'f', 'h', 'n', 'q', 's', 'u', 'v', 'y', 'z'];
  fc.assert(
    fc.property(fc.constantFrom(...safeCtrlLetters), (letter) => {
      const code = letter.charCodeAt(0) - 96;
      const bindings = resolveMuxShortcutBindings({
        'mux.conversation.new': [`ctrl+${letter}`],
      });

      assert.equal(detectMuxGlobalShortcut(Buffer.from([code]), bindings), 'mux.conversation.new');
      assert.equal(
        detectMuxGlobalShortcut(
          Buffer.from(`\u001b[${String(letter.charCodeAt(0))};5u`, 'utf8'),
          bindings,
        ),
        'mux.conversation.new',
      );
      assert.equal(
        detectMuxGlobalShortcut(
          Buffer.from(`\u001b[27;5;${String(letter.charCodeAt(0))}~`, 'utf8'),
          bindings,
        ),
        'mux.conversation.new',
      );
    }),
    { numRuns: 80 },
  );
});

void test('property: shortcut parser never throws on arbitrary input bytes', () => {
  const bindings = resolveMuxShortcutBindings();
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
      const input = Buffer.from(bytes);
      const result = detectMuxGlobalShortcut(input, bindings);
      assert.ok(result === null || typeof result === 'string');
    }),
    { numRuns: 200 },
  );
});
