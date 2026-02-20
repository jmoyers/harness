import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { diffUiCommandToStateAction, parseDiffUiCommand } from '../src/diff-ui/commands.ts';

void test('parseDiffUiCommand parses valid command payloads and rejects invalid input', () => {
  assert.equal(parseDiffUiCommand(null), null);
  assert.equal(parseDiffUiCommand([]), null);
  assert.equal(parseDiffUiCommand({}), null);
  assert.equal(parseDiffUiCommand({ type: 'view.setMode', mode: 'auto' })?.type, 'view.setMode');
  assert.equal(parseDiffUiCommand({ type: 'view.setMode', mode: 'bad' }), null);
  assert.equal(parseDiffUiCommand({ type: 'nav.scroll', delta: 1 })?.type, 'nav.scroll');
  assert.equal(parseDiffUiCommand({ type: 'nav.scroll', delta: '1' }), null);
  assert.equal(parseDiffUiCommand({ type: 'nav.page', delta: -1 })?.type, 'nav.page');
  assert.equal(parseDiffUiCommand({ type: 'nav.gotoFile', index: 2 })?.type, 'nav.gotoFile');
  assert.equal(parseDiffUiCommand({ type: 'nav.gotoFile', index: '2' }), null);
  assert.equal(parseDiffUiCommand({ type: 'nav.gotoHunk', index: 1 })?.type, 'nav.gotoHunk');
  assert.equal(parseDiffUiCommand({ type: 'finder.open' })?.type, 'finder.open');
  assert.equal(parseDiffUiCommand({ type: 'finder.close' })?.type, 'finder.close');
  assert.equal(parseDiffUiCommand({ type: 'finder.accept' })?.type, 'finder.accept');
  assert.equal(parseDiffUiCommand({ type: 'finder.query', query: 'abc' })?.type, 'finder.query');
  assert.equal(parseDiffUiCommand({ type: 'finder.query', query: 1 }), null);
  assert.equal(parseDiffUiCommand({ type: 'finder.move', delta: 1 })?.type, 'finder.move');
  assert.equal(parseDiffUiCommand({ type: 'finder.move', delta: '1' }), null);
  assert.equal(parseDiffUiCommand({ type: 'search.set', query: 'abc' })?.type, 'search.set');
  assert.equal(parseDiffUiCommand({ type: 'session.quit' })?.type, 'session.quit');
  assert.equal(parseDiffUiCommand({ type: 'unknown' }), null);
});

void test('diffUiCommandToStateAction maps parsed commands to state actions', () => {
  assert.deepEqual(diffUiCommandToStateAction({ type: 'view.setMode', mode: 'split' }, 5), {
    type: 'view.setMode',
    mode: 'split',
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'nav.scroll', delta: 2.9 }, 5), {
    type: 'nav.scroll',
    delta: 2,
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'nav.page', delta: -1.1 }, 7), {
    type: 'nav.page',
    delta: -1,
    pageSize: 7,
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'nav.gotoFile', index: 3.8 }, 5), {
    type: 'nav.gotoFile',
    fileIndex: 3,
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'nav.gotoHunk', index: 9.2 }, 5), {
    type: 'nav.gotoHunk',
    hunkIndex: 9,
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'finder.open' }, 5), {
    type: 'finder.open',
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'finder.close' }, 5), {
    type: 'finder.close',
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'finder.query', query: 'x' }, 5), {
    type: 'finder.query',
    query: 'x',
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'finder.move', delta: 4.2 }, 5), {
    type: 'finder.move',
    delta: 4,
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'finder.accept' }, 5), {
    type: 'finder.accept',
  });
  assert.deepEqual(diffUiCommandToStateAction({ type: 'search.set', query: 'q' }, 5), {
    type: 'search.set',
    query: 'q',
  });
});
