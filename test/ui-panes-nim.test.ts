import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { NimPane } from '../src/ui/panes/nim.ts';

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

void test('nim pane renders shell rows with transcript and composer sections', () => {
  const pane = new NimPane();
  const result = pane.render({
    layout: {
      rightCols: 40,
      paneRows: 8,
    },
    viewModel: {
      sessionId: 'session-12345678',
      status: 'responding',
      uiMode: 'debug',
      composerText: 'ship it',
      queuedCount: 1,
      transcriptLines: ['you> hello', 'nim> hi there'],
      assistantDraftText: 'working',
    },
  });
  const plainRows = result.rows.map((row) => stripAnsi(row));

  assert.equal(result.rows.length, 8);
  assert.equal(plainRows[0]?.includes('nim'), true);
  assert.equal(plainRows[0]?.includes('responding'), true);
  assert.equal(plainRows[1]?.includes('session:'), true);
  assert.equal(plainRows[1]?.includes('mode:debug'), true);
  assert.equal(plainRows[1]?.includes('queued:1'), true);
  assert.equal(plainRows[2]?.includes('enter=send/steer'), true);
  assert.equal(plainRows[3]?.includes('transcript'), true);
  assert.equal(plainRows.some((row) => row.includes('nim> hi there')), true);
  assert.equal(plainRows.some((row) => row.includes('nim> working')), true);
  assert.equal(plainRows[6]?.includes('composer'), true);
  assert.equal(plainRows[7]?.includes('nim> ship it'), true);
});

void test('nim pane supports zero-row layouts', () => {
  const pane = new NimPane();
  const result = pane.render({
    layout: {
      rightCols: 20,
      paneRows: 0,
    },
    viewModel: {
      sessionId: null,
      status: 'idle',
      uiMode: 'user',
      composerText: '',
      queuedCount: 0,
      transcriptLines: [],
      assistantDraftText: '',
    },
  });

  assert.deepEqual(result.rows, []);
});
