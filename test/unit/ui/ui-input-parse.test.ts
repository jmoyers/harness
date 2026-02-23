import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import {
  parseKeyInput,
  parseSgrMouse,
  parseInput,
} from '../../../packages/harness-ui/src/widget/input.ts';

function buf(str: string): Buffer {
  return Buffer.from(str, 'utf8');
}

function byte(n: number): Buffer {
  return Buffer.from([n]);
}

describe('parseKeyInput', () => {
  test('empty buffer returns null', () => {
    assert.equal(parseKeyInput(Buffer.alloc(0)), null);
  });

  test('printable ASCII character', () => {
    const e = parseKeyInput(buf('a'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'a');
    assert.equal(e!.ctrl, false);
    assert.equal(e!.shift, false);
  });

  test('uppercase ASCII has shift', () => {
    const e = parseKeyInput(buf('A'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'A');
    assert.equal(e!.shift, true);
  });

  test('space character', () => {
    const e = parseKeyInput(buf(' '));
    assert.notEqual(e, null);
    assert.equal(e!.key, ' ');
  });

  test('escape key (0x1b)', () => {
    const e = parseKeyInput(byte(0x1b));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'escape');
  });

  test('backspace (0x7f)', () => {
    const e = parseKeyInput(byte(0x7f));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'backspace');
  });

  test('enter (0x0d)', () => {
    const e = parseKeyInput(byte(0x0d));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'enter');
  });

  test('tab (0x09)', () => {
    const e = parseKeyInput(byte(0x09));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'tab');
  });

  test('ctrl+c (0x03)', () => {
    const e = parseKeyInput(byte(0x03));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'c');
    assert.equal(e!.ctrl, true);
  });

  test('ctrl+a (0x01)', () => {
    const e = parseKeyInput(byte(0x01));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'a');
    assert.equal(e!.ctrl, true);
  });

  test('ctrl+z (0x1a)', () => {
    const e = parseKeyInput(byte(0x1a));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'z');
    assert.equal(e!.ctrl, true);
  });

  test('alt+a (ESC a)', () => {
    const e = parseKeyInput(buf('\x1ba'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'a');
    assert.equal(e!.alt, true);
  });

  test('arrow up', () => {
    const e = parseKeyInput(buf('\x1b[A'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'up');
  });

  test('arrow down', () => {
    const e = parseKeyInput(buf('\x1b[B'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'down');
  });

  test('arrow right', () => {
    const e = parseKeyInput(buf('\x1b[C'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'right');
  });

  test('arrow left', () => {
    const e = parseKeyInput(buf('\x1b[D'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'left');
  });

  test('home', () => {
    const e = parseKeyInput(buf('\x1b[H'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'home');
  });

  test('end', () => {
    const e = parseKeyInput(buf('\x1b[F'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'end');
  });

  test('delete', () => {
    const e = parseKeyInput(buf('\x1b[3~'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'delete');
  });

  test('pageup', () => {
    const e = parseKeyInput(buf('\x1b[5~'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'pageup');
  });

  test('pagedown', () => {
    const e = parseKeyInput(buf('\x1b[6~'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'pagedown');
  });

  test('shift+tab', () => {
    const e = parseKeyInput(buf('\x1b[Z'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'tab');
    assert.equal(e!.shift, true);
  });

  test('f1', () => {
    const e = parseKeyInput(buf('\x1bOP'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'f1');
  });

  test('f5', () => {
    const e = parseKeyInput(buf('\x1b[15~'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'f5');
  });

  test('ctrl+up (CSI with modifier)', () => {
    const e = parseKeyInput(buf('\x1b[1;5A'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'up');
    assert.equal(e!.ctrl, true);
  });

  test('shift+right (CSI with modifier)', () => {
    const e = parseKeyInput(buf('\x1b[1;2C'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'right');
    assert.equal(e!.shift, true);
  });

  test('alt+delete (CSI with modifier)', () => {
    const e = parseKeyInput(buf('\x1b[3;3~'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'delete');
    assert.equal(e!.alt, true);
  });

  test('multi-byte UTF-8 character', () => {
    const e = parseKeyInput(buf('é'));
    assert.notEqual(e, null);
    assert.equal(e!.key, 'é');
  });
});

describe('parseSgrMouse', () => {
  test('left press at col 10 row 5', () => {
    const e = parseSgrMouse(buf('\x1b[<0;10;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'press');
    assert.equal(e!.button, 0);
    assert.equal(e!.col, 10);
    assert.equal(e!.row, 5);
  });

  test('left release', () => {
    const e = parseSgrMouse(buf('\x1b[<0;10;5m'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'release');
  });

  test('right press (button 2)', () => {
    const e = parseSgrMouse(buf('\x1b[<2;1;1M'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'press');
    assert.equal(e!.button, 2);
  });

  test('wheel up', () => {
    const e = parseSgrMouse(buf('\x1b[<64;10;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'wheel');
    assert.equal(e!.wheelDelta, -1);
  });

  test('wheel down', () => {
    const e = parseSgrMouse(buf('\x1b[<65;10;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'wheel');
    assert.equal(e!.wheelDelta, 1);
  });

  test('motion event', () => {
    const e = parseSgrMouse(buf('\x1b[<32;15;10M'));
    assert.notEqual(e, null);
    assert.equal(e!.kind, 'move');
  });

  test('ctrl+click', () => {
    const e = parseSgrMouse(buf('\x1b[<16;5;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.ctrl, true);
  });

  test('shift+click', () => {
    const e = parseSgrMouse(buf('\x1b[<4;5;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.shift, true);
  });

  test('non-mouse input returns null', () => {
    assert.equal(parseSgrMouse(buf('\x1b[A')), null);
    assert.equal(parseSgrMouse(buf('a')), null);
  });
});

describe('parseInput', () => {
  test('routes key input', () => {
    const e = parseInput(buf('a'));
    assert.notEqual(e, null);
    assert.equal(e!.type, 'key');
  });

  test('routes mouse input', () => {
    const e = parseInput(buf('\x1b[<0;10;5M'));
    assert.notEqual(e, null);
    assert.equal(e!.type, 'mouse');
  });

  test('returns null for unrecognized', () => {
    assert.equal(parseInput(Buffer.alloc(0)), null);
  });
});
