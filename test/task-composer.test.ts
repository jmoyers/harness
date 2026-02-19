import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createTaskComposerBuffer,
  insertTaskComposerText,
  normalizeTaskComposerBuffer,
  replaceTaskComposerText,
  taskComposerBackspace,
  taskComposerDeleteForward,
  taskComposerDeleteToLineEnd,
  taskComposerDeleteToLineStart,
  taskComposerDeleteWordLeft,
  taskComposerMoveLeft,
  taskComposerMoveLineEnd,
  taskComposerMoveLineStart,
  taskComposerMoveRight,
  taskComposerMoveVertical,
  taskComposerMoveWordLeft,
  taskComposerMoveWordRight,
  taskComposerTextFromTaskFields,
  taskComposerVisibleLines,
  taskFieldsFromComposerText,
} from '../src/mux/task-composer.ts';

void test('composer buffer create/normalize/replace are stable', () => {
  const created = createTaskComposerBuffer('hello');
  assert.equal(created.text, 'hello');
  assert.equal(created.cursor, 5);

  const normalized = normalizeTaskComposerBuffer({
    text: 'abc',
    cursor: 99,
  });
  assert.equal(normalized.cursor, 3);

  const normalizedNaN = normalizeTaskComposerBuffer({
    text: 'abc',
    cursor: Number.NaN,
  });
  assert.equal(normalizedNaN.cursor, 3);

  const replaced = replaceTaskComposerText(created, 'a\nb', -4);
  assert.equal(replaced.text, 'a\nb');
  assert.equal(replaced.cursor, 0);
});

void test('insert/backspace/delete-forward update text and cursor', () => {
  const inserted = insertTaskComposerText(
    {
      text: 'ab',
      cursor: 1,
    },
    'Z',
  );
  assert.equal(inserted.text, 'aZb');
  assert.equal(inserted.cursor, 2);

  const backspaced = taskComposerBackspace(inserted);
  assert.equal(backspaced.text, 'ab');
  assert.equal(backspaced.cursor, 1);

  const backspaceAtStart = taskComposerBackspace({
    text: 'ab',
    cursor: 0,
  });
  assert.deepEqual(backspaceAtStart, {
    text: 'ab',
    cursor: 0,
  });

  const deleted = taskComposerDeleteForward({
    text: 'abc',
    cursor: 1,
  });
  assert.deepEqual(deleted, {
    text: 'ac',
    cursor: 1,
  });

  const deleteAtEnd = taskComposerDeleteForward({
    text: 'abc',
    cursor: 3,
  });
  assert.deepEqual(deleteAtEnd, {
    text: 'abc',
    cursor: 3,
  });
});

void test('left/right and line start/end movement work across lines', () => {
  const text = 'one\ntwo';
  const movedLeft = taskComposerMoveLeft({
    text,
    cursor: 1,
  });
  assert.equal(movedLeft.cursor, 0);

  const movedLeftFloor = taskComposerMoveLeft({
    text,
    cursor: 0,
  });
  assert.equal(movedLeftFloor.cursor, 0);

  const movedRight = taskComposerMoveRight({
    text,
    cursor: 1,
  });
  assert.equal(movedRight.cursor, 2);

  const movedRightCeil = taskComposerMoveRight({
    text,
    cursor: text.length,
  });
  assert.equal(movedRightCeil.cursor, text.length);

  const lineStart = taskComposerMoveLineStart({
    text,
    cursor: 6,
  });
  assert.equal(lineStart.cursor, 4);

  const lineEnd = taskComposerMoveLineEnd({
    text,
    cursor: 5,
  });
  assert.equal(lineEnd.cursor, 7);

  const lineStartEmpty = taskComposerMoveLineStart({
    text: '',
    cursor: 0,
  });
  assert.equal(lineStartEmpty.cursor, 0);
});

void test('word movement and word delete support whitespace and punctuation', () => {
  const sample = {
    text: 'alpha  beta,gamma',
    cursor: 13,
  };
  const left = taskComposerMoveWordLeft(sample);
  assert.equal(left.cursor, 12);

  const leftFromWhitespace = taskComposerMoveWordLeft({
    text: 'alpha   beta',
    cursor: 8,
  });
  assert.equal(leftFromWhitespace.cursor, 0);

  const right = taskComposerMoveWordRight({
    text: 'alpha  beta',
    cursor: 0,
  });
  assert.equal(right.cursor, 5);

  const rightThroughWhitespace = taskComposerMoveWordRight({
    text: 'alpha  beta',
    cursor: 5,
  });
  assert.equal(rightThroughWhitespace.cursor, 11);

  const deletedWord = taskComposerDeleteWordLeft({
    text: 'alpha beta',
    cursor: 10,
  });
  assert.deepEqual(deletedWord, {
    text: 'alpha ',
    cursor: 6,
  });

  const deletedWordNoop = taskComposerDeleteWordLeft({
    text: '',
    cursor: 0,
  });
  assert.deepEqual(deletedWordNoop, {
    text: '',
    cursor: 0,
  });
});

void test('delete to line start/end trims only the current line segment', () => {
  const base = {
    text: 'abc\ndef',
    cursor: 5,
  };
  const toStart = taskComposerDeleteToLineStart(base);
  assert.deepEqual(toStart, {
    text: 'abc\nef',
    cursor: 4,
  });

  const toStartNoop = taskComposerDeleteToLineStart({
    text: 'abc',
    cursor: 0,
  });
  assert.deepEqual(toStartNoop, {
    text: 'abc',
    cursor: 0,
  });

  const toEnd = taskComposerDeleteToLineEnd(base);
  assert.deepEqual(toEnd, {
    text: 'abc\nd',
    cursor: 5,
  });

  const toEndNoop = taskComposerDeleteToLineEnd({
    text: 'abc',
    cursor: 3,
  });
  assert.deepEqual(toEndNoop, {
    text: 'abc',
    cursor: 3,
  });
});

void test('vertical movement reports boundaries for top and bottom lines', () => {
  const base = {
    text: 'a\nbb\nccc',
    cursor: 3,
  };
  const up = taskComposerMoveVertical(base, -1);
  assert.equal(up.hitBoundary, false);
  assert.equal(up.next.cursor, 1);

  const down = taskComposerMoveVertical(base, 1);
  assert.equal(down.hitBoundary, false);
  assert.equal(down.next.cursor, 6);

  const topBoundary = taskComposerMoveVertical(
    {
      text: 'a\nb',
      cursor: 0,
    },
    -1,
  );
  assert.equal(topBoundary.hitBoundary, true);
  assert.equal(topBoundary.next.cursor, 0);

  const bottomBoundary = taskComposerMoveVertical(
    {
      text: 'a\nb',
      cursor: 3,
    },
    1,
  );
  assert.equal(bottomBoundary.hitBoundary, true);
  assert.equal(bottomBoundary.next.cursor, 3);
});

void test('visible lines and task field conversion preserve multiline payloads', () => {
  const lines = taskComposerVisibleLines({
    text: 'line-1\nline-2',
    cursor: 3,
  });
  assert.deepEqual(lines, ['lin_e-1', 'line-2']);

  const fields = taskFieldsFromComposerText('title\nbody line 1\nbody line 2');
  assert.deepEqual(fields, {
    title: 'title',
    body: 'title\nbody line 1\nbody line 2',
  });

  const fieldsTrimmed = taskFieldsFromComposerText('  title padded  \nbody');
  assert.equal(fieldsTrimmed.title, 'title padded');
  assert.equal(fieldsTrimmed.body, '  title padded  \nbody');

  assert.equal(taskComposerTextFromTaskFields('title', ''), 'title');
  assert.equal(taskComposerTextFromTaskFields('title', 'body'), 'body');
});
