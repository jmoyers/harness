import type { ConversationState } from '../mux/live-mux/conversation-state.ts';

export interface StartupVisibility {
  visibleGlyphCellCount(conversation: ConversationState): number;
  codexHeaderVisible(conversation: ConversationState): boolean;
}

export function createStartupVisibility(): StartupVisibility {
  function visibleGlyphCellCount(conversation: ConversationState): number {
    const frame = conversation.oracle.snapshotWithoutHash();
    let count = 0;
    for (const line of frame.richLines) {
      for (const cell of line.cells) {
        if (!cell.continued && cell.glyph.trim().length > 0) {
          count += 1;
        }
      }
    }
    return count;
  }

  function codexHeaderVisible(conversation: ConversationState): boolean {
    const frame = conversation.oracle.snapshotWithoutHash();
    const rows: string[] = [];
    for (const line of frame.richLines) {
      let row = '';
      for (const cell of line.cells) {
        if (cell.continued) {
          continue;
        }
        row += cell.glyph;
      }
      rows.push(row.trimEnd());
    }
    const text = rows.join('\n');
    return text.includes('OpenAI Codex') && text.includes('model:') && text.includes('directory:');
  }

  return {
    visibleGlyphCellCount,
    codexHeaderVisible,
  };
}
