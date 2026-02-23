import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import {
  DEFAULT_COLOR,
  DEFAULT_CELL_STYLE,
  rgbColor,
  indexedColor,
  parseHexColor,
  colorEqual,
  colorToHex,
  colorSgrParams,
  cellStyleEqual,
  cellStyleToSgr,
  type Color,
  type CellStyle,
} from '../../../packages/harness-ui/src/core/color.ts';

describe('Color', () => {
  test('DEFAULT_COLOR is default kind', () => {
    assert.equal(DEFAULT_COLOR.kind, 'default');
  });

  test('rgbColor clamps to 0-255', () => {
    const c = rgbColor(-10, 300, 128.7);
    assert.equal(c.kind, 'rgb');
    assert.equal((c as Extract<Color, { kind: 'rgb' }>).r, 0);
    assert.equal((c as Extract<Color, { kind: 'rgb' }>).g, 255);
    assert.equal((c as Extract<Color, { kind: 'rgb' }>).b, 128);
  });

  test('rgbColor handles NaN as 0', () => {
    const c = rgbColor(NaN, Infinity, -Infinity);
    assert.equal(c.kind, 'rgb');
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 0);
    assert.equal(rgb.g, 0);
    assert.equal(rgb.b, 0);
  });

  test('indexedColor clamps to 0-255', () => {
    assert.equal((indexedColor(-1) as Extract<Color, { kind: 'indexed' }>).index, 0);
    assert.equal((indexedColor(256) as Extract<Color, { kind: 'indexed' }>).index, 255);
    assert.equal((indexedColor(42) as Extract<Color, { kind: 'indexed' }>).index, 42);
  });
});

describe('parseHexColor', () => {
  test('parses 3-digit hex with #', () => {
    const c = parseHexColor('#f0a');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 255);
    assert.equal(rgb.g, 0);
    assert.equal(rgb.b, 170);
  });

  test('parses 6-digit hex with #', () => {
    const c = parseHexColor('#1a2b3c');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 0x1a);
    assert.equal(rgb.g, 0x2b);
    assert.equal(rgb.b, 0x3c);
  });

  test('parses 6-digit hex without #', () => {
    const c = parseHexColor('ff8800');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 255);
    assert.equal(rgb.g, 136);
    assert.equal(rgb.b, 0);
  });

  test('parses 3-digit hex without #', () => {
    const c = parseHexColor('abc');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 170);
    assert.equal(rgb.g, 187);
    assert.equal(rgb.b, 204);
  });

  test('parses 8-digit hex (ignores alpha)', () => {
    const c = parseHexColor('#ff0000ff');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 255);
    assert.equal(rgb.g, 0);
    assert.equal(rgb.b, 0);
  });

  test('parses 4-digit hex (ignores alpha)', () => {
    const c = parseHexColor('#f00f');
    assert.notEqual(c, null);
    const rgb = c as Extract<Color, { kind: 'rgb' }>;
    assert.equal(rgb.r, 255);
    assert.equal(rgb.g, 0);
    assert.equal(rgb.b, 0);
  });

  test('returns null for empty string', () => {
    assert.equal(parseHexColor(''), null);
  });

  test('returns null for invalid hex chars', () => {
    assert.equal(parseHexColor('#gggggg'), null);
  });

  test('returns null for wrong length', () => {
    assert.equal(parseHexColor('#12'), null);
    assert.equal(parseHexColor('#12345'), null);
  });

  test('case insensitive', () => {
    const lower = parseHexColor('#aabbcc');
    const upper = parseHexColor('#AABBCC');
    assert.notEqual(lower, null);
    assert.notEqual(upper, null);
    assert.ok(colorEqual(lower!, upper!));
  });
});

describe('colorEqual', () => {
  test('default equals default', () => {
    assert.ok(colorEqual(DEFAULT_COLOR, DEFAULT_COLOR));
  });

  test('same rgb equals', () => {
    assert.ok(colorEqual(rgbColor(10, 20, 30), rgbColor(10, 20, 30)));
  });

  test('different rgb not equal', () => {
    assert.ok(!colorEqual(rgbColor(10, 20, 30), rgbColor(10, 20, 31)));
  });

  test('same indexed equals', () => {
    assert.ok(colorEqual(indexedColor(42), indexedColor(42)));
  });

  test('different indexed not equal', () => {
    assert.ok(!colorEqual(indexedColor(42), indexedColor(43)));
  });

  test('different kinds not equal', () => {
    assert.ok(!colorEqual(DEFAULT_COLOR, rgbColor(0, 0, 0)));
    assert.ok(!colorEqual(indexedColor(0), rgbColor(0, 0, 0)));
    assert.ok(!colorEqual(DEFAULT_COLOR, indexedColor(0)));
  });
});

describe('colorToHex', () => {
  test('rgb to hex', () => {
    assert.equal(colorToHex(rgbColor(255, 0, 128)), '#ff0080');
  });

  test('default returns null', () => {
    assert.equal(colorToHex(DEFAULT_COLOR), null);
  });

  test('indexed returns null', () => {
    assert.equal(colorToHex(indexedColor(42)), null);
  });

  test('pads single-digit components', () => {
    assert.equal(colorToHex(rgbColor(0, 1, 15)), '#00010f');
  });
});

describe('colorSgrParams', () => {
  test('default fg', () => {
    assert.deepEqual(colorSgrParams(DEFAULT_COLOR, 'fg'), ['39']);
  });

  test('default bg', () => {
    assert.deepEqual(colorSgrParams(DEFAULT_COLOR, 'bg'), ['49']);
  });

  test('indexed fg', () => {
    assert.deepEqual(colorSgrParams(indexedColor(196), 'fg'), ['38', '5', '196']);
  });

  test('indexed bg', () => {
    assert.deepEqual(colorSgrParams(indexedColor(196), 'bg'), ['48', '5', '196']);
  });

  test('rgb fg', () => {
    assert.deepEqual(colorSgrParams(rgbColor(10, 20, 30), 'fg'), ['38', '2', '10', '20', '30']);
  });

  test('rgb bg', () => {
    assert.deepEqual(colorSgrParams(rgbColor(10, 20, 30), 'bg'), ['48', '2', '10', '20', '30']);
  });
});

describe('CellStyle', () => {
  test('DEFAULT_CELL_STYLE has all flags false', () => {
    assert.equal(DEFAULT_CELL_STYLE.bold, false);
    assert.equal(DEFAULT_CELL_STYLE.dim, false);
    assert.equal(DEFAULT_CELL_STYLE.italic, false);
    assert.equal(DEFAULT_CELL_STYLE.underline, false);
    assert.equal(DEFAULT_CELL_STYLE.inverse, false);
    assert.equal(DEFAULT_CELL_STYLE.fg.kind, 'default');
    assert.equal(DEFAULT_CELL_STYLE.bg.kind, 'default');
  });

  test('cellStyleEqual matches identical styles', () => {
    assert.ok(cellStyleEqual(DEFAULT_CELL_STYLE, DEFAULT_CELL_STYLE));
  });

  test('cellStyleEqual detects bold difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, bold: true };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects dim difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, dim: true };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects italic difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, italic: true };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects underline difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, underline: true };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects inverse difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, inverse: true };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects fg difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });

  test('cellStyleEqual detects bg difference', () => {
    const styled: CellStyle = { ...DEFAULT_CELL_STYLE, bg: indexedColor(42) };
    assert.ok(!cellStyleEqual(DEFAULT_CELL_STYLE, styled));
  });
});

describe('cellStyleToSgr', () => {
  test('default style resets only', () => {
    const sgr = cellStyleToSgr(DEFAULT_CELL_STYLE);
    assert.equal(sgr, '\u001b[0;39;49m');
  });

  test('bold adds code 1', () => {
    const sgr = cellStyleToSgr({ ...DEFAULT_CELL_STYLE, bold: true });
    assert.ok(sgr.includes(';1;'));
  });

  test('all flags set', () => {
    const style: CellStyle = {
      fg: rgbColor(255, 0, 0),
      bg: indexedColor(42),
      bold: true,
      dim: true,
      italic: true,
      underline: true,
      inverse: true,
    };
    const sgr = cellStyleToSgr(style);
    assert.ok(sgr.startsWith('\u001b['));
    assert.ok(sgr.endsWith('m'));
    assert.ok(sgr.includes('1'));
    assert.ok(sgr.includes('2'));
    assert.ok(sgr.includes('3'));
    assert.ok(sgr.includes('4'));
    assert.ok(sgr.includes('7'));
    assert.ok(sgr.includes('38;2;255;0;0'));
    assert.ok(sgr.includes('48;5;42'));
  });
});
