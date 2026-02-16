import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOscColorReplies, parseOscRgbHex } from '../src/mux/live-mux/palette-parsing.ts';

void test('parseOscRgbHex validates and normalizes rgb payloads', () => {
  assert.equal(parseOscRgbHex('nope'), null);
  assert.equal(parseOscRgbHex('rgb:ff/00'), null);
  assert.equal(parseOscRgbHex('rgb:zz/00/00'), null);
  assert.equal(parseOscRgbHex('rgb:12345/00/00'), null);
  assert.equal(parseOscRgbHex('rgb:f/f/f'), 'ffffff');
  assert.equal(parseOscRgbHex('rgb:7f/00/ff'), '7f00ff');
});

void test('extractOscColorReplies parses foreground/background/indexed colors', () => {
  const payload = [
    'noise',
    '\u001b]10?\u0007',
    '\u001b]10;rgb:ff/ff/ff\u0007',
    '\u001b]11;rgb:00/00/00\u001b\\',
    '\u001b]4;7\u0007',
    '\u001b]4;7;rgb:ff/00/80\u0007',
    '\u001b]4;999;rgb:ff/ff/ff\u0007',
    '\u001b]4;x;rgb:ff/ff/ff\u0007',
    'tail'
  ].join('');
  const extracted = extractOscColorReplies(payload);

  assert.equal(extracted.foregroundHex, 'ffffff');
  assert.equal(extracted.backgroundHex, '000000');
  assert.deepEqual(extracted.indexedHexByCode, { 7: 'ff0080' });
  assert.equal(extracted.remainder, 'tail');
});

void test('extractOscColorReplies keeps truncated remainder when no OSC sequence is present', () => {
  const extracted = extractOscColorReplies('x'.repeat(600));

  assert.equal(extracted.foregroundHex, undefined);
  assert.equal(extracted.backgroundHex, undefined);
  assert.deepEqual(extracted.indexedHexByCode, {});
  assert.equal(extracted.remainder.length, 512);
});

void test('extractOscColorReplies retains incomplete OSC sequence remainder', () => {
  const extracted = extractOscColorReplies('prefix\u001b]10;rgb:ff/ff/ff');
  assert.equal(extracted.remainder, '\u001b]10;rgb:ff/ff/ff');
});
