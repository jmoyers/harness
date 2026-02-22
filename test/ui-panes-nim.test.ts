import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { NimPane } from '../src/ui/panes/nim.ts';

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

  assert.equal(result.rows.length, 8);
  assert.equal(result.rows[0]?.includes('nim'), true);
  assert.equal(result.rows[1]?.includes('status:responding'), true);
  assert.equal(result.rows[1]?.includes('mode:debug'), true);
  assert.equal(result.rows[1]?.includes('queued:1'), true);
  assert.equal(result.rows[2]?.includes('enter=send/steer'), true);
  assert.equal(result.rows[3]?.includes('transcript'), true);
  assert.equal(result.rows.some((row) => row.includes('nim> hi there')), true);
  assert.equal(result.rows.some((row) => row.includes('nim> working')), true);
  assert.equal(result.rows[6]?.includes('composer'), true);
  assert.equal(result.rows[7]?.trimStart().startsWith('nim> ship it'), true);
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
