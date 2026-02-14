import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import {
  createTerminalRecordingWriter,
  readTerminalRecording
} from '../src/recording/terminal-recording.ts';
import {
  __terminalGifInternals,
  renderTerminalRecordingToGif
} from '../scripts/terminal-recording-gif-lib.ts';

function defaultColorLookup() {
  return {
    defaults: {
      foreground: [208, 215, 222] as const,
      background: [15, 20, 25] as const
    },
    indexedPalette: new Map<number, readonly [number, number, number]>()
  };
}

function gifSize(buffer: Buffer): { width: number; height: number } {
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

void test('terminal recording to gif pipeline renders an animated gif artifact', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-gif-e2e-'));
  const recordingPath = join(tempDir, 'mux-recording.jsonl');
  const outputPath = join(tempDir, 'mux-recording.gif');
  const oracle = new TerminalSnapshotOracle(14, 4);
  const timestamps = [0, 42, 120];
  let timestampIndex = 0;

  try {
    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'mux-e2e',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419',
      nowMs: () => {
        const next = timestamps[timestampIndex];
        timestampIndex += 1;
        return next ?? 120;
      },
      nowIso: () => '2026-02-14T00:00:00.000Z'
    });

    oracle.ingest('\u001b[31;42mA\u001b[0m');
    writer.capture(oracle.snapshot());
    oracle.ingest('\n\u001b[38;5;201;48;5;22mB\u001b[0m');
    writer.capture(oracle.snapshot());
    oracle.ingest('\n\u001b[38;2;8;9;10;48;2;1;2;3mC\u001b[0m');
    writer.capture(oracle.snapshot());
    await writer.close();

    const result = await renderTerminalRecordingToGif({
      recordingPath,
      outputPath,
      cellWidthPx: 8,
      cellHeightPx: 16,
      fontSizePx: 12,
      defaultFrameDurationMs: 55,
      maxColors: 300
    });

    assert.equal(result.frameCount, 3);
    assert.equal(result.width, 112);
    assert.equal(result.height, 64);
    assert.equal(result.bytes > 0, true);

    const bytes = readFileSync(outputPath);
    assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.deepEqual(gifSize(bytes), {
      width: 112,
      height: 64
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal gif internals cover color mapping delay planning and render plan branches', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-gif-internals-'));
  const recordingPath = join(tempDir, 'recording.jsonl');
  const outputPath = join(tempDir, 'output.gif');
  const oracle = new TerminalSnapshotOracle(6, 3);

  try {
    assert.deepEqual(__terminalGifInternals.indexedColor(-1), [0, 0, 0]);
    assert.deepEqual(__terminalGifInternals.indexedColor(999), [0, 0, 0]);
    assert.deepEqual(__terminalGifInternals.indexedColor(2), [13, 188, 121]);
    assert.deepEqual(__terminalGifInternals.indexedColor(33), [0, 135, 255]);
    assert.deepEqual(__terminalGifInternals.indexedColor(245), [138, 138, 138]);
    assert.deepEqual(
      __terminalGifInternals.indexedColorWithPalette(9, {
        defaults: {
          foreground: [208, 215, 222],
          background: [15, 20, 25]
        },
        indexedPalette: new Map([[9, [2, 3, 4] as const]])
      }),
      [2, 3, 4]
    );
    assert.deepEqual(__terminalGifInternals.parseHexColor('bad', [1, 2, 3]), [1, 2, 3]);
    assert.deepEqual(__terminalGifInternals.parseHexColor('#112233', [1, 2, 3]), [17, 34, 51]);

    oracle.ingest('\u001b[7mX\u001b[0m\t\u001b[4m \u001b[0m');
    oracle.ingest('\n\u001b[3 q'); // blinking underline cursor style
    let frame = oracle.snapshot();
    frame = {
      ...frame,
      cursor: {
        ...frame.cursor,
        visible: true
      }
    };

    const planWithCursor = __terminalGifInternals.createRenderPlan(
      frame,
      defaultColorLookup(),
      true
    );
    assert.equal(planWithCursor.cursor !== null, true);

    const planWithoutCursor = __terminalGifInternals.createRenderPlan(
      frame,
      defaultColorLookup(),
      false
    );
    assert.equal(planWithoutCursor.cursor, null);

    const sparseFrame = {
      ...frame,
      richLines: []
    };
    const sparsePlan = __terminalGifInternals.createRenderPlan(
      sparseFrame,
      defaultColorLookup(),
      false
    );
    assert.equal(sparsePlan.glyphs.length, 0);
    const emptyGlyphFrame = {
      ...frame,
      richLines: frame.richLines.map((line, rowIdx) => {
        if (rowIdx !== 0) {
          return line;
        }
        return {
          ...line,
          cells: line.cells.map((cell, colIdx) => {
            if (colIdx !== 0) {
              return cell;
            }
            return {
              ...cell,
              glyph: '',
              style: {
                ...cell.style,
                underline: false
              }
            };
          })
        };
      })
    };
    const emptyGlyphPlan = __terminalGifInternals.createRenderPlan(
      emptyGlyphFrame,
      defaultColorLookup(),
      false
    );
    assert.equal(emptyGlyphPlan.glyphs.every((glyph) => glyph.glyph.length > 0 || glyph.style.underline), true);
    const sparseRendered = __terminalGifInternals.renderFrameRgba(
      sparseFrame,
      defaultColorLookup(),
      7,
      15,
      11,
      'Menlo, monospace',
      false
    );
    assert.equal(sparseRendered.rgba.length, 42 * 45 * 4);

    const rendered = __terminalGifInternals.renderFrameRgba(
      frame,
      defaultColorLookup(),
      7,
      15,
      11,
      'Menlo, monospace',
      true
    );
    assert.equal(rendered.width, 42);
    assert.equal(rendered.height, 45);
    assert.equal(rendered.rgba.length, 42 * 45 * 4);

    const wideOracle = new TerminalSnapshotOracle(4, 2);
    wideOracle.ingest('界');
    let wideFrame = wideOracle.snapshot();
    wideFrame = {
      ...wideFrame,
      cursor: {
        ...wideFrame.cursor,
        visible: true,
        style: {
          shape: 'bar',
          blinking: false
        }
      }
    };
    const barRendered = __terminalGifInternals.renderFrameRgba(
      wideFrame,
      defaultColorLookup(),
      8,
      16,
      12,
      'Menlo, monospace',
      true
    );
    assert.equal(barRendered.rgba.length, 4 * 2 * 8 * 16 * 4);

    const italicBoldOracle = new TerminalSnapshotOracle(4, 2);
    italicBoldOracle.ingest('\u001b[1;3mZ');
    let italicBoldFrame = italicBoldOracle.snapshot();
    italicBoldFrame = {
      ...italicBoldFrame,
      cursor: {
        ...italicBoldFrame.cursor,
        visible: true,
        style: {
          shape: 'block',
          blinking: true
        }
      }
    };
    const blockRendered = __terminalGifInternals.renderFrameRgba(
      italicBoldFrame,
      defaultColorLookup(),
      8,
      16,
      12,
      'Menlo, monospace',
      true
    );
    assert.equal(blockRendered.rgba.length, 4 * 2 * 8 * 16 * 4);

    const hiddenCursorPlan = __terminalGifInternals.createRenderPlan(
      {
        ...frame,
        cursor: {
          ...frame.cursor,
          visible: false
        }
      },
      defaultColorLookup(),
      true
    );
    assert.equal(hiddenCursorPlan.cursor, null);
    const negativeRowCursorPlan = __terminalGifInternals.createRenderPlan(
      {
        ...frame,
        cursor: {
          ...frame.cursor,
          row: -1
        }
      },
      defaultColorLookup(),
      true
    );
    assert.equal(negativeRowCursorPlan.cursor, null);
    const overflowRowCursorPlan = __terminalGifInternals.createRenderPlan(
      {
        ...frame,
        cursor: {
          ...frame.cursor,
          row: frame.rows
        }
      },
      defaultColorLookup(),
      true
    );
    assert.equal(overflowRowCursorPlan.cursor, null);
    const negativeColCursorPlan = __terminalGifInternals.createRenderPlan(
      {
        ...frame,
        cursor: {
          ...frame.cursor,
          col: -1
        }
      },
      defaultColorLookup(),
      true
    );
    assert.equal(negativeColCursorPlan.cursor, null);
    const overflowColCursorPlan = __terminalGifInternals.createRenderPlan(
      {
        ...frame,
        cursor: {
          ...frame.cursor,
          col: frame.cols
        }
      },
      defaultColorLookup(),
      true
    );
    assert.equal(overflowColCursorPlan.cursor, null);

    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'delay-test',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419',
      nowMs: (() => {
        let value = 0;
        return () => {
          value += 5;
          return value;
        };
      })(),
      nowIso: () => '2026-02-14T00:00:00.000Z'
    });
    writer.capture(frame);
    await writer.close();

    const singleFrameRecording = readTerminalRecording(recordingPath);
    assert.equal(singleFrameRecording.finishedAtMs, 10);
    assert.equal(__terminalGifInternals.frameDelayMs(singleFrameRecording, 0, 77), 10);
    assert.equal(__terminalGifInternals.frameDelayMs(singleFrameRecording, 99, 77), 77);
    assert.equal(
      __terminalGifInternals.frameDelayMs(
        {
          header: singleFrameRecording.header,
          finishedAtMs: null,
          frames: [
            singleFrameRecording.frames[0]!,
            {
              atMs: 1,
              frame: singleFrameRecording.frames[0]!.frame
            }
          ]
        },
        0,
        77
      ),
      77
    );
    assert.equal(
      __terminalGifInternals.frameDelayMs(
        {
          header: singleFrameRecording.header,
          finishedAtMs: null,
          frames: [
            {
              atMs: 1,
              frame: singleFrameRecording.frames[0]!.frame
            },
            {
              atMs: 6,
              frame: singleFrameRecording.frames[0]!.frame
            }
          ]
        },
        0,
        77
      ),
      10
    );
    assert.equal(
      __terminalGifInternals.frameDelayMs(
        {
          header: singleFrameRecording.header,
          finishedAtMs: 29,
          frames: [
            {
              atMs: 3,
              frame: singleFrameRecording.frames[0]!.frame
            }
          ]
        },
        0,
        77
      ),
      26
    );
    assert.deepEqual(
      __terminalGifInternals.buildFrameDelaysMs(
        {
          header: singleFrameRecording.header,
          finishedAtMs: null,
          frames: [
            {
              atMs: 0,
              frame: singleFrameRecording.frames[0]!.frame
            },
            {
              atMs: 14,
              frame: singleFrameRecording.frames[0]!.frame
            },
            {
              atMs: 28,
              frame: singleFrameRecording.frames[0]!.frame
            }
          ]
        },
        50
      ),
      [14, 14, 50]
    );
    assert.deepEqual(
      [...__terminalGifInternals.parseIndexedPalette(
        {
          header: {
            ...singleFrameRecording.header,
            ansiPaletteIndexedHex: {
              0: '0f1419',
              7: '#d0d7de',
              999: 'ffffff',
              2: 'invalid'
            }
          },
          finishedAtMs: null,
          frames: singleFrameRecording.frames
        },
        [208, 215, 222],
        [15, 20, 25]
      ).entries()],
      [
        [0, [15, 20, 25]],
        [2, [208, 215, 222]],
        [7, [208, 215, 222]]
      ]
    );

    writeFileSync(
      join(tempDir, 'header-only.jsonl'),
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n`,
      'utf8'
    );

    await assert.rejects(
      async () =>
        renderTerminalRecordingToGif({
          recordingPath: join(tempDir, 'header-only.jsonl'),
          outputPath
        }),
      /does not contain any frames/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal recording to gif cli script works end-to-end', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-gif-cli-'));
  const recordingPath = join(tempDir, 'recording.jsonl');
  const outputPath = join(tempDir, 'clip.gif');
  const oracle = new TerminalSnapshotOracle(5, 2);

  try {
    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'cli',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419',
      nowMs: (() => {
        let value = 0;
        return () => {
          value += 16;
          return value;
        };
      })(),
      nowIso: () => '2026-02-14T00:00:00.000Z'
    });
    oracle.ingest('hello');
    writer.capture(oracle.snapshot());
    oracle.ingest('\nworld');
    writer.capture(oracle.snapshot());
    await writer.close();

    writeFileSync(
      join(tempDir, 'header-only.jsonl'),
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n`,
      'utf8'
    );

    const stdout = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/terminal-recording-to-gif.ts',
        '--input',
        recordingPath,
        '--output',
        outputPath,
        '--cell-width',
        '8',
        '--cell-height',
        '16',
        '--font-size',
        '12',
        '--font-family',
        'Menlo, monospace',
        '--frame-ms',
        '50',
        '--max-colors',
        '120',
        '--no-cursor'
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8'
      }
    );

    assert.equal(stdout.includes('[recording->gif]'), true);
    const bytes = readFileSync(outputPath);
    assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal recording to gif applies minimum clamps for tiny option values', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-gif-clamp-'));
  const recordingPath = join(tempDir, 'recording.jsonl');
  const outputPath = join(tempDir, 'tiny.gif');
  const oracle = new TerminalSnapshotOracle(2, 1);

  try {
    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'clamp',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419',
      nowMs: () => 1,
      nowIso: () => '2026-02-14T00:00:00.000Z'
    });
    oracle.ingest('x');
    writer.capture(oracle.snapshot());
    await writer.close();

    const result = await renderTerminalRecordingToGif({
      recordingPath,
      outputPath,
      cellWidthPx: 1,
      cellHeightPx: 1,
      fontSizePx: 1,
      maxColors: 1
    });
    assert.equal(result.width, 8);
    assert.equal(result.height, 8);
    assert.equal(readFileSync(outputPath).subarray(0, 6).toString('ascii'), 'GIF89a');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
