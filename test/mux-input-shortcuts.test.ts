import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  detectMuxGlobalShortcut,
  firstShortcutText,
  normalizeMuxKeyboardInputForPty,
  resolveMuxShortcutBindings,
} from '../src/mux/input-shortcuts.ts';

void test('detectMuxGlobalShortcut maps default raw control-byte bindings', () => {
  const bindings = resolveMuxShortcutBindings();
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14]), bindings), 'mux.conversation.new');
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from([0x07]), bindings),
    'mux.conversation.critique.open-or-create',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0a]), bindings), 'mux.conversation.next');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0b]), bindings), 'mux.conversation.previous');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0c]), bindings), 'mux.conversation.takeover');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x03]), bindings), 'mux.app.interrupt-all');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x10]), bindings), 'mux.command-menu.toggle');
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from([0x12]), bindings),
    'mux.conversation.titles.refresh-all',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001br', 'utf8'), bindings),
    'mux.gateway.status-timeline.toggle',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001bR', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x18]), bindings), 'mux.conversation.delete');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0f]), bindings), 'mux.directory.add');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x17]), bindings), 'mux.directory.close');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x08]), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from([0x1d]), bindings),
    'mux.gateway.render-trace.toggle',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x74]), bindings), null);
});

void test('detectMuxGlobalShortcut parses kitty and modifyOtherKeys control combos', () => {
  const bindings = resolveMuxShortcutBindings();
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;5u', 'utf8'), bindings),
    'mux.conversation.new',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[103;5u', 'utf8'), bindings),
    'mux.conversation.critique.open-or-create',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[106;5u', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[107;5u', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[108;5u', 'utf8'), bindings),
    'mux.conversation.takeover',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[114;5u', 'utf8'), bindings),
    'mux.conversation.titles.refresh-all',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[112;5u', 'utf8'), bindings),
    'mux.command-menu.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[112;9u', 'utf8'), bindings),
    'mux.command-menu.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[112;6u', 'utf8'), bindings),
    'mux.gateway.profile.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[114;3u', 'utf8'), bindings),
    'mux.gateway.status-timeline.toggle',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[114;4u', 'utf8'), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[93;5u', 'utf8'), bindings),
    'mux.gateway.render-trace.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;116~', 'utf8'), bindings),
    'mux.conversation.new',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;103~', 'utf8'), bindings),
    'mux.conversation.critique.open-or-create',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;106~', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;107~', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;108~', 'utf8'), bindings),
    'mux.conversation.takeover',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;114~', 'utf8'), bindings),
    'mux.conversation.titles.refresh-all',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;112~', 'utf8'), bindings),
    'mux.command-menu.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;9;112~', 'utf8'), bindings),
    'mux.command-menu.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;6;112~', 'utf8'), bindings),
    'mux.gateway.profile.toggle',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;3;114~', 'utf8'), bindings),
    'mux.gateway.status-timeline.toggle',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;4;114~', 'utf8'), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;93~', 'utf8'), bindings),
    'mux.gateway.render-trace.toggle',
  );
});

void test('shortcut bindings do not alias ctrl and cmd/meta implicitly', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+t'],
    'mux.app.quit': ['cmd+q'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;9u', 'utf8'), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[113;9u', 'utf8'), bindings),
    'mux.app.quit',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x11]), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[99;9u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x03]), bindings), 'mux.app.interrupt-all');
});

void test('shortcut bindings deduplicate repeated normalized strokes', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+t', 'control+t'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14]), bindings), 'mux.conversation.new');
});

void test('resolveMuxShortcutBindings applies config overrides and display helpers', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.next': ['alt+j', 'ctrl+n'],
    'mux.conversation.previous': ['alt+k'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.app.quit': ['ctrl+q'],
    'mux.unknown.action': ['ctrl+x'],
  });

  assert.equal(firstShortcutText(bindings, 'mux.app.quit'), 'ctrl+q');
  assert.equal(firstShortcutText(bindings, 'mux.conversation.new'), 'ctrl+t');
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001bj', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001bk', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x11]), bindings), 'mux.app.quit');
});

void test('shortcut parsing ignores malformed bindings and malformed protocol sequences', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+', '', '+', 'meta+bad+token', 'ctrl+t'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['unknownkey', 'ctrl+j'],
    'mux.conversation.previous': ['ctrl+h'],
    'mux.app.quit': ['ctrl+]'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14]), bindings), 'mux.conversation.new');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;xu', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[x;5u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[-2;5u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;0u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;-2u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[300;5u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5;1;9u', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;x;116~', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;x~', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5~', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;999~', 'utf8'), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x80]), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1b, 0x80]), bindings), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('plain-text', 'utf8'), bindings), null);
});

void test('shortcut parser handles named keys aliases and modifier combinations', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['esc', 't'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['return'],
    'mux.conversation.previous': ['tab'],
    'mux.app.quit': ['spacebar'],
    'mux.app.interrupt-all': ['ctrl+shift+j', 'cmd+q'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1b]), bindings), 'mux.conversation.new');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0d]), bindings), 'mux.conversation.next');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x09]), bindings), 'mux.conversation.previous');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x20]), bindings), 'mux.app.quit');
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116u', 'utf8'), bindings),
    'mux.conversation.new',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[27;1u', 'utf8'), bindings),
    'mux.conversation.new',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[13;1u', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[9;1u', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[32;1u', 'utf8'), bindings),
    'mux.app.quit',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[106;6u', 'utf8'), bindings),
    'mux.app.interrupt-all',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[113;9u', 'utf8'), bindings),
    'mux.app.interrupt-all',
  );
});

void test('control punctuation shortcuts decode through raw bytes', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+\\'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['ctrl+^'],
    'mux.conversation.previous': ['ctrl+_'],
    'mux.app.quit': ['ctrl+]'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1c]), bindings), 'mux.conversation.new');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1e]), bindings), 'mux.conversation.next');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1f]), bindings), 'mux.conversation.previous');
});

void test('shortcut parser covers alias tokens and non-escape two-byte input guard', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['control+t'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['super+n'],
    'mux.conversation.previous': ['option+p'],
    'mux.app.quit': ['ctrl+]'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14]), bindings), 'mux.conversation.new');
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[110;9u', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001bp', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x20, 0x20]), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;5:1u', 'utf8'), bindings),
    'mux.conversation.new',
  );
});

void test('shortcut parser stress-covers decode paths across raw kitty and modify variants', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+t', 'escape'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['ctrl+j', 'enter'],
    'mux.conversation.previous': ['ctrl+h', 'tab'],
    'mux.app.quit': ['ctrl+]', 'space'],
    'mux.app.interrupt-all': ['ctrl+c', 'meta+q', 'alt+p'],
  });

  for (let code = 0; code <= 255; code += 1) {
    void detectMuxGlobalShortcut(Buffer.from([code]), bindings);
  }

  const kittyKeyCodes = [-2, 9, 13, 27, 32, 65, 104, 106, 110, 113, 116, 300];
  const kittyModifiers = [-2, 0, 1, 2, 5, 6, 9];
  for (const keyCode of kittyKeyCodes) {
    for (const modifier of kittyModifiers) {
      void detectMuxGlobalShortcut(
        Buffer.from(`\u001b[${String(keyCode)};${String(modifier)}u`, 'utf8'),
        bindings,
      );
    }
  }
  void detectMuxGlobalShortcut(Buffer.from('\u001b[116;5;1u', 'utf8'), bindings);

  const modifyModifiers = [-2, 0, 1, 2, 5, 6, 9];
  const modifyKeyCodes = [-2, 9, 13, 27, 32, 65, 99, 104, 106, 113, 116, 300];
  for (const modifier of modifyModifiers) {
    for (const keyCode of modifyKeyCodes) {
      void detectMuxGlobalShortcut(
        Buffer.from(`\u001b[27;${String(modifier)};${String(keyCode)}~`, 'utf8'),
        bindings,
      );
    }
  }

  void detectMuxGlobalShortcut(Buffer.from('\u001b[broken', 'utf8'), bindings);
  void detectMuxGlobalShortcut(Buffer.from('\u001b', 'utf8'), bindings);
});

void test('firstShortcutText falls back when action has no configured bindings', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': [],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['ctrl+j'],
    'mux.conversation.previous': ['ctrl+h'],
    'mux.app.quit': ['ctrl+]'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(firstShortcutText(bindings, 'mux.conversation.new'), '');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14]), bindings), null);
});

void test('shortcut matcher covers modifier mismatch branches for equal keys', () => {
  const bindings = resolveMuxShortcutBindings({
    'mux.conversation.new': ['ctrl+t'],
    'mux.conversation.critique.open-or-create': ['ctrl+g'],
    'mux.conversation.next': ['ctrl+alt+t'],
    'mux.conversation.previous': ['ctrl+alt+shift+t'],
    'mux.app.quit': ['ctrl+alt+shift+meta+t'],
    'mux.app.interrupt-all': ['ctrl+c'],
  });

  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;1u', 'utf8'), bindings), null);
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;5u', 'utf8'), bindings),
    'mux.conversation.new',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;7u', 'utf8'), bindings),
    'mux.conversation.next',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;8u', 'utf8'), bindings),
    'mux.conversation.previous',
  );
  assert.equal(
    detectMuxGlobalShortcut(Buffer.from('\u001b[116;16u', 'utf8'), bindings),
    'mux.app.quit',
  );
});

void test('normalizeMuxKeyboardInputForPty decodes ctrl-r keyboard protocol sequences', () => {
  assert.deepEqual(
    normalizeMuxKeyboardInputForPty(Buffer.from('\u001b[114;5u', 'utf8')),
    Buffer.from([0x12]),
  );
  assert.deepEqual(
    normalizeMuxKeyboardInputForPty(Buffer.from('\u001b[27;5;114~', 'utf8')),
    Buffer.from([0x12]),
  );
});

void test('normalizeMuxKeyboardInputForPty keeps passthrough bytes and decodes representable keys', () => {
  assert.deepEqual(
    normalizeMuxKeyboardInputForPty(Buffer.from('ab\u001b[114;5uc', 'utf8')),
    Buffer.from('ab\u0012c', 'utf8'),
  );
  assert.deepEqual(
    normalizeMuxKeyboardInputForPty(Buffer.from('\u001b[300;5u', 'utf8')),
    Buffer.from('\u001b[300;5u', 'utf8'),
  );
});

void test('normalizeMuxKeyboardInputForPty covers legacy key mappings and fallback branches', () => {
  const matrix: ReadonlyArray<readonly [string, Buffer]> = [
    ['\u001b[32;5u', Buffer.from([0x00])],
    ['\u001b[13;5u', Buffer.from([0x0d])],
    ['\u001b[9;5u', Buffer.from([0x09])],
    ['\u001b[27;5u', Buffer.from([0x1b])],
    ['\u001b[64;5u', Buffer.from([0x00])],
    ['\u001b[91;5u', Buffer.from([0x1b])],
    ['\u001b[92;5u', Buffer.from([0x1c])],
    ['\u001b[93;5u', Buffer.from([0x1d])],
    ['\u001b[94;5u', Buffer.from([0x1e])],
    ['\u001b[95;5u', Buffer.from([0x1f])],
    ['\u001b[63;5u', Buffer.from([0x7f])],
    ['\u001b[13;1u', Buffer.from([0x0d])],
    ['\u001b[13;2u', Buffer.from('\u001b[13;2u', 'utf8')],
    ['\u001b[9;1u', Buffer.from([0x09])],
    ['\u001b[27;1u', Buffer.from([0x1b])],
    ['\u001b[32;1u', Buffer.from([0x20])],
    ['\u001b[97;2u', Buffer.from('A', 'utf8')],
    ['\u001b[114;3u', Buffer.from('\u001br', 'utf8')],
    ['\u001b[33;5u', Buffer.from('\u001b[33;5u', 'utf8')],
    ['\u001b[broken', Buffer.from('\u001b[broken', 'utf8')],
    ['\u001b[27;5;114~', Buffer.from([0x12])],
    ['\u001b[27;2;13~', Buffer.from('\u001b[27;2;13~', 'utf8')],
  ];

  for (const [encoded, expected] of matrix) {
    assert.deepEqual(normalizeMuxKeyboardInputForPty(Buffer.from(encoded, 'utf8')), expected);
  }

  assert.deepEqual(
    normalizeMuxKeyboardInputForPty(Buffer.from('plain', 'utf8')),
    Buffer.from('plain', 'utf8'),
  );
});
