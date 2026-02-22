import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  cursorStyleEqual,
  cursorStyleToDecscusr,
  diffRenderedRows,
  findAnsiIntegrityIssues,
} from '../../../packages/harness-ui/src/frame-primitives.ts';

test('frame primitives diff emits only changed rows and keeps next snapshot', () => {
  const result = diffRenderedRows(['a', 'b', ''], ['a', 'x', 'z']);
  assert.deepEqual(result.changedRows, [1, 2]);
  assert.equal(result.output.includes('\u001b[2;1H\u001b[2Kb'), true);
  assert.equal(result.output.includes('\u001b[3;1H\u001b[2K'), true);
  assert.deepEqual(result.nextRows, ['a', 'b', '']);
});

test('frame primitives cursor helpers map DEC styles and equality checks', () => {
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'block',
      blinking: true,
    }),
    '\u001b[1 q',
  );
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'block',
      blinking: false,
    }),
    '\u001b[2 q',
  );
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'underline',
      blinking: true,
    }),
    '\u001b[3 q',
  );
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'underline',
      blinking: false,
    }),
    '\u001b[4 q',
  );
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'bar',
      blinking: true,
    }),
    '\u001b[5 q',
  );
  assert.equal(
    cursorStyleToDecscusr({
      shape: 'bar',
      blinking: false,
    }),
    '\u001b[6 q',
  );
  assert.equal(
    cursorStyleEqual(null, {
      shape: 'bar',
      blinking: false,
    }),
    false,
  );
  assert.equal(
    cursorStyleEqual(
      {
        shape: 'bar',
        blinking: false,
      },
      {
        shape: 'bar',
        blinking: false,
      },
    ),
    true,
  );
  assert.equal(
    cursorStyleEqual(
      {
        shape: 'bar',
        blinking: false,
      },
      {
        shape: 'underline',
        blinking: false,
      },
    ),
    false,
  );
});

test('frame primitives ansi integrity scanner reports malformed sequences', () => {
  const issues = findAnsiIntegrityIssues([
    '\u001b[31mred\u001b[0m',
    'dangling\u001b',
    '\u001b[12',
    '\u001b[1\u0007m',
    '\u001b]0;title',
    '\u001b]0;title\u001b\\',
  ]);
  assert.equal(issues.length, 4);
  assert.equal(issues[0]?.includes('row 2'), true);
  assert.equal(issues[0]?.includes('dangling ESC'), true);
  assert.equal(issues[1]?.includes('unterminated CSI sequence'), true);
  assert.equal(issues[2]?.includes('invalid CSI byte'), true);
  assert.equal(issues[3]?.includes('unterminated OSC sequence'), true);
});

test('frame primitives ansi integrity scanner accepts OSC BEL and unknown ESC followers', () => {
  const issues = findAnsiIntegrityIssues(['\u001b]0;title\u0007', '\u001bPpayload']);
  assert.deepEqual(issues, []);
});
