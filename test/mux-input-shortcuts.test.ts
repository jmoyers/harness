import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMuxGlobalShortcut } from '../src/mux/input-shortcuts.ts';

void test('detectMuxGlobalShortcut maps raw control bytes', () => {
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x74])), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x14])), 'new-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x0e])), 'next-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x10])), 'previous-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x1d])), 'quit');
  assert.equal(detectMuxGlobalShortcut(Buffer.from([0x03])), 'ctrl-c');
});

void test('detectMuxGlobalShortcut parses kitty keyboard protocol ctrl combinations', () => {
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[99;5u', 'utf8')), 'ctrl-c');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5u', 'utf8')), 'new-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[110;5u', 'utf8')), 'next-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[112;5u', 'utf8')), 'previous-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[93;5u', 'utf8')), 'quit');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5;1u', 'utf8')), 'new-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5:1u', 'utf8')), 'new-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[120;5u', 'utf8')), null);
});

void test('detectMuxGlobalShortcut ignores non-ctrl kitty variants and malformed sequences', () => {
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;1u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;xu', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[x;5u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5;1;9u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;0u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;-2u', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[116;5~', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('plain-text', 'utf8')), null);
});

void test('detectMuxGlobalShortcut parses modifyOtherKeys ctrl combinations', () => {
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;99~', 'utf8')), 'ctrl-c');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;116~', 'utf8')), 'new-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;110~', 'utf8')), 'next-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;112~', 'utf8')), 'previous-conversation');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;93~', 'utf8')), 'quit');
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;1;116~', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;120~', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5~', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;x;116~', 'utf8')), null);
  assert.equal(detectMuxGlobalShortcut(Buffer.from('\u001b[27;5;x~', 'utf8')), null);
});
