import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import { FrameBuffer } from '../../../packages/harness-ui/src/core/frame-buffer.ts';
import {
  DEFAULT_CELL_STYLE,
  rgbColor,
  type CellStyle,
} from '../../../packages/harness-ui/src/core/color.ts';

const RED: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
const BLUE: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 0, 255) };

describe('FrameBuffer construction', () => {
  test('creates with correct dimensions', () => {
    const fb = new FrameBuffer(80, 24);
    assert.equal(fb.cols, 80);
    assert.equal(fb.rows, 24);
  });

  test('buffer is writable', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'hello', RED);
    assert.equal(fb.buffer.getCell(0, 0)!.glyph, 'h');
  });
});

describe('FrameBuffer commit', () => {
  test('first commit marks all rows changed', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'abc', RED);
    const diff = fb.commit();
    assert.equal(diff.changedCount, 1);
    assert.ok(diff.changedRows.includes(0));
  });

  test('no-change commit returns zero changed', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'abc', RED);
    fb.commit();
    const diff2 = fb.commit();
    assert.equal(diff2.changedCount, 0);
    assert.deepEqual([...diff2.changedRows], []);
  });

  test('changing one row only marks that row', () => {
    const fb = new FrameBuffer(10, 5);
    fb.buffer.drawText(0, 0, 'aaaa', RED);
    fb.buffer.drawText(0, 2, 'bbbb', RED);
    fb.commit();
    fb.buffer.drawText(0, 2, 'cccc', BLUE);
    const diff = fb.commit();
    assert.equal(diff.changedCount, 1);
    assert.deepEqual([...diff.changedRows], [2]);
  });

  test('changing multiple rows marks all of them', () => {
    const fb = new FrameBuffer(10, 5);
    fb.commit();
    fb.buffer.drawText(0, 0, 'new0', RED);
    fb.buffer.drawText(0, 4, 'new4', BLUE);
    const diff = fb.commit();
    assert.ok(diff.changedRows.includes(0));
    assert.ok(diff.changedRows.includes(4));
    assert.ok(!diff.changedRows.includes(2));
  });
});

describe('FrameBuffer ANSI caching', () => {
  test('renderAnsiRows returns all rows', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'hi', RED);
    fb.commit();
    const rows = fb.renderAnsiRows();
    assert.equal(rows.length, 3);
    assert.ok(rows[0]!.includes('hi'));
  });

  test('cached rows reuse same string', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'test', RED);
    fb.commit();
    const rows1 = fb.renderAnsiRows();
    const rows2 = fb.renderAnsiRows();
    assert.equal(rows1[0], rows2[0]);
    assert.equal(rows1[1], rows2[1]);
  });

  test('changed row gets new string after commit', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'old', RED);
    fb.commit();
    const rows1 = fb.renderAnsiRows();
    fb.buffer.drawText(0, 0, 'new', BLUE);
    fb.commit();
    const rows2 = fb.renderAnsiRows();
    assert.notEqual(rows1[0], rows2[0]);
    assert.equal(rows1[1], rows2[1]);
  });

  test('renderChangedAnsiRows returns only dirty rows', () => {
    const fb = new FrameBuffer(10, 5);
    fb.buffer.drawText(0, 0, 'aaa', RED);
    fb.buffer.drawText(0, 2, 'bbb', RED);
    fb.commit();
    fb.renderAnsiRows();
    fb.buffer.drawText(0, 2, 'ccc', BLUE);
    fb.commit();
    const changed = fb.renderChangedAnsiRows();
    assert.equal(changed.length, 1);
    assert.equal(changed[0]!.row, 2);
    assert.ok(changed[0]!.ansi.includes('ccc'));
  });

  test('no-change renderChangedAnsiRows returns empty', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'stable', RED);
    fb.commit();
    fb.renderAnsiRows();
    fb.commit();
    const changed = fb.renderChangedAnsiRows();
    assert.equal(changed.length, 0);
  });
});

describe('FrameBuffer resize', () => {
  test('resize resets everything', () => {
    const fb = new FrameBuffer(10, 3);
    fb.buffer.drawText(0, 0, 'old', RED);
    fb.commit();
    fb.renderAnsiRows();
    fb.resize(20, 5);
    assert.equal(fb.cols, 20);
    assert.equal(fb.rows, 5);
    const rows = fb.renderAnsiRows();
    assert.equal(rows.length, 5);
  });
});

describe('FrameBuffer dirty tracking', () => {
  test('dirtyRowCount reflects state', () => {
    const fb = new FrameBuffer(10, 5);
    fb.buffer.drawText(0, 0, 'a', RED);
    fb.commit();
    fb.renderAnsiRows();
    assert.equal(fb.dirtyRowCount(), 0);
    fb.markRowDirty(2);
    assert.equal(fb.dirtyRowCount(), 1);
    fb.markAllDirty();
    assert.equal(fb.dirtyRowCount(), 5);
  });
});
