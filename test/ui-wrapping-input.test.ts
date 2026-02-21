import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TextLayoutEngine, WrappingInputRenderer } from '../packages/harness-ui/src/text-layout.ts';

const WRAPPING_INPUT_RENDERER = new WrappingInputRenderer();

void test('wrapping input renders wrapped cursor text and appends cursor at line end', () => {
  const middleCursor = WRAPPING_INPUT_RENDERER.renderLines({
    buffer: {
      text: 'abcdef',
      cursor: 2,
    },
    width: 4,
    cursorVisible: true,
    cursorToken: '█',
  });
  assert.deepEqual(middleCursor, ['ab█d', 'ef']);

  const endCursor = WRAPPING_INPUT_RENDERER.renderLines({
    buffer: {
      text: 'abcd',
      cursor: 99,
    },
    width: 4,
    cursorVisible: true,
    cursorToken: '█',
  });
  assert.deepEqual(endCursor, ['abcd', '█']);
});

void test('wrapping input supports hidden cursor, prefixes, and invalid cursor values', () => {
  const prefixed = WRAPPING_INPUT_RENDERER.renderLines({
    buffer: {
      text: 'line one\nline two',
      cursor: Number.NaN,
    },
    width: 20,
    cursorVisible: false,
    linePrefix: '○ ',
  });
  assert.deepEqual(prefixed, ['○ line one', '○ line two']);

  const narrow = WRAPPING_INPUT_RENDERER.renderLines({
    buffer: {
      text: 'long line',
      cursor: 0,
    },
    width: 5,
    cursorVisible: false,
    linePrefix: '> ',
  });
  assert.deepEqual(narrow, ['> lon', 'g lin', 'e']);
});

void test('text layout engine truncates with ellipsis and exposes measure/wrap helpers', () => {
  const layout = new TextLayoutEngine();
  assert.equal(layout.measure('abc'), 3);
  assert.deepEqual(layout.wrap('abcd', 2), ['ab', 'cd']);
  assert.equal(layout.truncate('abcd', 1), '…');
});
