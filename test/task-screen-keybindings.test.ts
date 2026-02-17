import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW,
  detectTaskScreenKeybindingAction,
  firstTaskScreenShortcutText,
  resolveTaskScreenKeybindings,
  type ResolvedTaskScreenKeybindings,
  type TaskScreenKeybindingAction
} from '../src/mux/task-screen-keybindings.ts';

void test('task screen keybinding exported types remain reachable from src/test graph', () => {
  const action: TaskScreenKeybindingAction = 'mux.home.task.queue';
  const resolved: ResolvedTaskScreenKeybindings = resolveTaskScreenKeybindings();
  assert.equal(action, 'mux.home.task.queue');
  assert.equal(typeof resolved.rawByAction[action][0], 'string');
});

void test('task screen keybindings default and override resolution are stable', () => {
  const defaults = resolveTaskScreenKeybindings();
  assert.equal(
    firstTaskScreenShortcutText(defaults, 'mux.home.task.submit'),
    DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW['mux.home.task.submit'][0]
  );

  const overridden = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['ctrl+enter'],
    'mux.home.editor.cursor.left': ['alt+h'],
    'mux.home.repo.dropdown.toggle': ['ctrl+r']
  });
  assert.equal(
    firstTaskScreenShortcutText(overridden, 'mux.home.task.submit'),
    'ctrl+enter'
  );
  assert.equal(
    firstTaskScreenShortcutText(overridden, 'mux.home.editor.cursor.left'),
    'alt+h'
  );
  assert.equal(
    firstTaskScreenShortcutText(overridden, 'mux.home.repo.dropdown.toggle'),
    'ctrl+r'
  );
});

void test('task screen keybinding detection supports single-byte controls and printable keys', () => {
  const bindings = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['enter'],
    'mux.home.task.queue': ['tab'],
    'mux.home.editor.delete.backward': ['backspace'],
    'mux.home.editor.line.start': ['ctrl+a'],
    'mux.home.editor.line.end': ['ctrl+e'],
    'mux.home.editor.word.left': ['alt+b'],
    'mux.home.editor.word.right': ['alt+f']
  });

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x0d]), bindings),
    'mux.home.task.submit'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x09]), bindings),
    'mux.home.task.queue'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x7f]), bindings),
    'mux.home.editor.delete.backward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x01]), bindings),
    'mux.home.editor.line.start'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x05]), bindings),
    'mux.home.editor.line.end'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001bb', 'utf8'), bindings),
    'mux.home.editor.word.left'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001bf', 'utf8'), bindings),
    'mux.home.editor.word.right'
  );
});

void test('task screen keybinding detection supports CSI arrows, home/end, delete and modifiers', () => {
  const bindings = resolveTaskScreenKeybindings({
    'mux.home.editor.cursor.up': ['up'],
    'mux.home.editor.cursor.down': ['down'],
    'mux.home.editor.cursor.left': ['left'],
    'mux.home.editor.cursor.right': ['right'],
    'mux.home.editor.line.start': ['home'],
    'mux.home.editor.line.end': ['end'],
    'mux.home.editor.delete.forward': ['delete'],
    'mux.home.task.reorder.up': ['alt+up'],
    'mux.home.task.reorder.down': ['ctrl+down']
  });

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[A', 'utf8'), bindings),
    'mux.home.editor.cursor.up'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[B', 'utf8'), bindings),
    'mux.home.editor.cursor.down'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[C', 'utf8'), bindings),
    'mux.home.editor.cursor.right'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[D', 'utf8'), bindings),
    'mux.home.editor.cursor.left'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[H', 'utf8'), bindings),
    'mux.home.editor.line.start'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[F', 'utf8'), bindings),
    'mux.home.editor.line.end'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[3~', 'utf8'), bindings),
    'mux.home.editor.delete.forward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;3A', 'utf8'), bindings),
    'mux.home.task.reorder.up'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;5B', 'utf8'), bindings),
    'mux.home.task.reorder.down'
  );
});

void test('task screen keybinding detection supports kitty and modifyOtherKeys enter variants', () => {
  const bindings = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['enter'],
    'mux.home.task.newline': ['shift+enter'],
    'mux.home.editor.delete.backward': ['backspace']
  });

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[13;1u', 'utf8'), bindings),
    'mux.home.task.submit'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[13;2u', 'utf8'), bindings),
    'mux.home.task.newline'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[27;1;13~', 'utf8'), bindings),
    'mux.home.task.submit'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[27;2;13~', 'utf8'), bindings),
    'mux.home.task.newline'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[127;1u', 'utf8'), bindings),
    'mux.home.editor.delete.backward'
  );
});

void test('task screen keybinding parser ignores malformed sequences and malformed binding tokens', () => {
  const bindings = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['ctrl+', '', 'enter', 'meta+bad+token'],
    'mux.home.editor.cursor.left': ['left'],
    'mux.home.editor.cursor.right': ['right'],
    'mux.home.editor.delete.forward': ['delete'],
    'mux.home.task.newline': ['shift+enter']
  });

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('plain-text', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[broken', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[27;0;13~', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;0A', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[2~', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[xyzu', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x1b, 0x80]), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x80]), bindings),
    null
  );
});

void test('task screen keybinding coverage matrix exercises protocol decode branches', () => {
  const bindings = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['space'],
    'mux.home.task.queue': ['ctrl+q'],
    'mux.home.task.newline': ['shift+enter'],
    'mux.home.editor.line.start': ['tab'],
    'mux.home.editor.line.end': ['escape'],
    'mux.home.editor.delete.backward': ['backspace'],
    'mux.home.editor.cursor.left': ['left'],
    'mux.home.editor.cursor.right': ['right'],
    'mux.home.editor.cursor.up': ['up'],
    'mux.home.editor.cursor.down': ['down'],
    'mux.home.editor.delete.forward': ['delete'],
    'mux.home.editor.word.left': ['a'],
    'mux.home.editor.word.right': ['home'],
    'mux.home.task.reorder.up': ['alt+up'],
    'mux.home.task.reorder.down': ['ctrl+down']
  });

  assert.equal(detectTaskScreenKeybindingAction(Buffer.from([0x09]), bindings), 'mux.home.editor.line.start');
  assert.equal(detectTaskScreenKeybindingAction(Buffer.from([0x1b]), bindings), 'mux.home.editor.line.end');
  assert.equal(detectTaskScreenKeybindingAction(Buffer.from([0x20]), bindings), 'mux.home.task.submit');
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x7f]), bindings),
    'mux.home.editor.delete.backward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x08]), bindings),
    'mux.home.editor.delete.backward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x61]), bindings),
    'mux.home.editor.word.left'
  );

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[9;1u', 'utf8'), bindings),
    'mux.home.editor.line.start'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[27;1u', 'utf8'), bindings),
    'mux.home.editor.line.end'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[32;1u', 'utf8'), bindings),
    'mux.home.task.submit'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[127;1u', 'utf8'), bindings),
    'mux.home.editor.delete.backward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[65;1u', 'utf8'), bindings),
    'mux.home.editor.word.left'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[300;1u', 'utf8'), bindings),
    null
  );

  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1~', 'utf8'), bindings),
    'mux.home.editor.word.right'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[4~', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[3;0~', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[3~', 'utf8'), bindings),
    'mux.home.editor.delete.forward'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;3A', 'utf8'), bindings),
    'mux.home.task.reorder.up'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;5B', 'utf8'), bindings),
    'mux.home.task.reorder.down'
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[1;1Z', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b[2~', 'utf8'), bindings),
    null
  );
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from('\u001b\u0080', 'utf8'), bindings),
    null
  );

  const malformedOnly = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['+', 'ctrl+']
  });
  assert.equal(detectTaskScreenKeybindingAction(Buffer.from([0x0d]), malformedOnly), null);
});

void test('task screen keybinding defaults map tab to queue action', () => {
  const bindings = resolveTaskScreenKeybindings();
  assert.equal(
    detectTaskScreenKeybindingAction(Buffer.from([0x09]), bindings),
    'mux.home.task.queue'
  );
});
