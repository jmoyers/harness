import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupVisibility } from '../../../../src/services/startup-visibility.ts';
import type { ConversationState } from '../../../../src/mux/live-mux/conversation-state.ts';

function createConversation(
  rows: Array<Array<{ readonly glyph: string; readonly continued?: boolean }>>,
): ConversationState {
  return {
    oracle: {
      snapshotWithoutHash: () => ({
        richLines: rows.map((row) => ({
          cells: row.map((cell) => ({
            continued: cell.continued ?? false,
            glyph: cell.glyph,
          })),
        })),
      }),
    },
  } as unknown as ConversationState;
}

void test('startup visibility counts only visible non-empty glyph cells', () => {
  const startupVisibility = new StartupVisibility();
  const conversation = createConversation([
    [{ glyph: 'A' }, { glyph: ' ', continued: false }, { glyph: 'B', continued: true }],
    [{ glyph: '\t' }, { glyph: 'C' }],
  ]);

  assert.equal(startupVisibility.visibleGlyphCellCount(conversation), 2);
});

void test('startup visibility detects codex header markers in visible text rows', () => {
  const startupVisibility = new StartupVisibility();
  const conversation = createConversation([
    [{ glyph: 'OpenAI ' }, { glyph: 'Codex' }, { glyph: '!', continued: true }],
    [{ glyph: 'model: gpt-5' }, { glyph: '   ' }],
    [{ glyph: 'directory: /tmp/workspace' }],
  ]);

  assert.equal(startupVisibility.codexHeaderVisible(conversation), true);
});

void test('startup visibility header detection returns false when marker fields are missing', () => {
  const startupVisibility = new StartupVisibility();
  const conversation = createConversation([
    [{ glyph: 'OpenAI Codex' }],
    [{ glyph: 'model: gpt-5' }],
  ]);

  assert.equal(startupVisibility.codexHeaderVisible(conversation), false);
});
