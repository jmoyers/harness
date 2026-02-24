import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { CellBuffer } from '../../../packages/harness-ui/src/core/cell-buffer.ts';
import { LandingView } from '../../../packages/nim/src/ui/views/landing-view.ts';

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

function renderView(view: LandingView, cols: number, rows: number): readonly string[] {
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

test('nim landing view renders default welcome copy', () => {
  const view = new LandingView();
  const rows = renderView(view, 80, 24);
  assert.equal(rows.some((row) => row.includes('harness coordination agent')), true);
});

test('nim landing view renders API key onboarding copy when required', () => {
  const view = new LandingView();
  view.apiKeyRequired = true;
  view.apiKeyDisplayName = 'Anthropic API Key';
  view.apiKeyEnvVar = 'ANTHROPIC_API_KEY';
  view.apiKeyEntryActive = true;
  const rows = renderView(view, 84, 28);
  assert.equal(rows.some((row) => row.includes('Anthropic API Key required')), true);
  assert.equal(rows.some((row) => row.includes('Press Enter to save key')), true);
  assert.equal(rows.some((row) => row.includes('ANTHROPIC_API_KEY')), true);
});
