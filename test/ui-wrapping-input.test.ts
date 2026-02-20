import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { renderWrappingInputLines } from '../src/ui/wrapping-input.ts';

void test('wrapping input renders wrapped cursor text and appends cursor at line end', () => {
  const middleCursor = renderWrappingInputLines({
    buffer: {
      text: 'abcdef',
      cursor: 2,
    },
    width: 4,
    cursorVisible: true,
    cursorToken: '█',
  });
  assert.deepEqual(middleCursor, ['ab█d', 'ef']);

  const endCursor = renderWrappingInputLines({
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
  const prefixed = renderWrappingInputLines({
    buffer: {
      text: 'line one\nline two',
      cursor: Number.NaN,
    },
    width: 20,
    cursorVisible: false,
    linePrefix: '○ ',
  });
  assert.deepEqual(prefixed, ['○ line one', '○ line two']);

  const narrow = renderWrappingInputLines({
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
