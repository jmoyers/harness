import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { CellBuffer } from '../../../packages/harness-ui/src/core/cell-buffer.ts';
import { SidebarView } from '../../../packages/nim/src/ui/views/sidebar-view.ts';

function stripAnsi(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (char === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      if (index < value.length && value[index] === 'm') {
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function renderView(view: SidebarView, cols: number, rows: number): readonly string[] {
  const buffer = new CellBuffer(cols, rows);
  const clipped = buffer.clip({
    x: 0,
    y: 0,
    width: cols,
    height: rows,
  });
  view.render(clipped);
  return buffer.renderAnsiRows().map((row) => stripAnsi(row));
}

test('nim sidebar omits placeholder MCP/LSP sections', () => {
  const view = new SidebarView();
  view.sessionStartedAt = '2026-02-25T12:00:00.000Z';
  const rows = renderView(view, 46, 28);

  assert.equal(
    rows.some((row) => row.includes('Context')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('Files Changed')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('No files changed yet')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('MCP')),
    false,
  );
  assert.equal(
    rows.some((row) => row.includes('LSP')),
    false,
  );
});

test('nim sidebar renders tracked file changes', () => {
  const view = new SidebarView();
  view.filesChanged = [{ file: 'src/app.ts', additions: 12, deletions: 3 }];
  const rows = renderView(view, 46, 28);

  assert.equal(
    rows.some((row) => row.includes('src/app.ts')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('+12  -3')),
    true,
  );
  assert.equal(
    rows.some((row) => row.includes('No files changed yet')),
    false,
  );
});
