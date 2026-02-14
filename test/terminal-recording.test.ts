import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import {
  createTerminalRecordingWriter,
  readTerminalRecording
} from '../src/recording/terminal-recording.ts';

class MemoryStream extends PassThrough {
  content = '';

  constructor() {
    super();
    this.setEncoding('utf8');
    this.on('data', (chunk) => {
      this.content += chunk as string;
    });
  }
}

class EndErrorStream extends MemoryStream {
  override end(callback?: () => void): this {
    this.emit('error', new Error('end failed'));
    if (callback !== undefined) {
      callback();
    }
    return this;
  }
}

void test('terminal recording writer captures distinct frames and enforces interval/hash gates', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-recording-'));
  const recordingPath = join(tempDir, 'recording.jsonl');
  const oracle = new TerminalSnapshotOracle(12, 4);
  const nowValues = [0, 5, 6, 12];
  let nowIndex = 0;

  try {
    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'test-run',
      defaultForegroundHex: '#D0D7DE',
      defaultBackgroundHex: 'invalid',
      minFrameIntervalMs: 10,
      nowMs: () => {
        const next = nowValues[nowIndex];
        nowIndex += 1;
        return next ?? 11;
      },
      nowIso: () => '2026-02-14T00:00:00.000Z'
    });

    oracle.ingest('A');
    const frameA = oracle.snapshot();
    assert.equal(writer.capture(frameA), true);
    assert.equal(writer.capture(frameA), false);

    oracle.ingest('B');
    const frameB = oracle.snapshot();
    assert.equal(writer.capture(frameB), false);
    assert.equal(writer.capture(frameB), true);
    await writer.close();
    await writer.close();

    const parsed = readTerminalRecording(recordingPath);
    assert.equal(parsed.header.schemaVersion, '1');
    assert.equal(parsed.header.source, 'test-run');
    assert.equal(parsed.header.defaultForegroundHex, 'd0d7de');
    assert.equal(parsed.header.defaultBackgroundHex, '0f1419');
    assert.equal(parsed.frames.length, 2);
    assert.equal(parsed.frames[0]?.atMs, 0);
    assert.equal(parsed.frames[1]?.atMs, 12);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal recording parser rejects malformed files and line records', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-recording-invalid-'));
  const emptyPath = join(tempDir, 'empty.jsonl');
  const noHeaderPath = join(tempDir, 'no-header.jsonl');
  const badHeaderPath = join(tempDir, 'bad-header.jsonl');
  const nonObjectHeaderPath = join(tempDir, 'non-object-header.jsonl');
  const missingHeaderFieldsPath = join(tempDir, 'missing-header-fields.jsonl');
  const nonObjectLinePath = join(tempDir, 'non-object-line.jsonl');
  const invalidKindPath = join(tempDir, 'invalid-kind.jsonl');
  const nonFramePath = join(tempDir, 'non-frame.jsonl');
  const badAtMsPath = join(tempDir, 'bad-atms.jsonl');
  const badFramePath = join(tempDir, 'bad-frame.jsonl');
  const nonObjectFramePath = join(tempDir, 'non-object-frame.jsonl');

  try {
    writeFileSync(emptyPath, '', 'utf8');
    writeFileSync(
      noHeaderPath,
      `${JSON.stringify({
        kind: 'frame',
        atMs: 1,
        frame: {
          rows: 1,
          cols: 1,
          lines: ['x'],
          richLines: []
        }
      })}\n`,
      'utf8'
    );
    writeFileSync(
      badHeaderPath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '2',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n`,
      'utf8'
    );
    writeFileSync(
      nonObjectHeaderPath,
      `${JSON.stringify({
        kind: 'header',
        header: 1
      })}\n`,
      'utf8'
    );
    writeFileSync(
      missingHeaderFieldsPath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1'
        }
      })}\n`,
      'utf8'
    );
    writeFileSync(nonObjectLinePath, '1\n', 'utf8');
    writeFileSync(
      invalidKindPath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n${JSON.stringify({
        kind: 'unexpected'
      })}\n`,
      'utf8'
    );
    writeFileSync(
      nonFramePath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n${JSON.stringify({
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
    writeFileSync(
      badAtMsPath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n${JSON.stringify({
        kind: 'frame',
        atMs: -1,
        frame: {
          rows: 1,
          cols: 1,
          lines: ['x'],
          richLines: []
        }
      })}\n`,
      'utf8'
    );
    writeFileSync(
      badFramePath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n${JSON.stringify({
        kind: 'frame',
        atMs: 1,
        frame: {
          rows: 0,
          cols: 1,
          lines: [],
          richLines: []
        }
      })}\n`,
      'utf8'
    );
    writeFileSync(
      nonObjectFramePath,
      `${JSON.stringify({
        kind: 'header',
        header: {
          schemaVersion: '1',
          source: 'x',
          createdAt: 't',
          defaultForegroundHex: 'd0d7de',
          defaultBackgroundHex: '0f1419'
        }
      })}\n${JSON.stringify({
        kind: 'frame',
        atMs: 1,
        frame: 1
      })}\n`,
      'utf8'
    );

    assert.throws(() => {
      readTerminalRecording(emptyPath);
    }, /empty/);
    assert.throws(() => {
      readTerminalRecording(noHeaderPath);
    }, /start with a header/);
    assert.throws(() => {
      readTerminalRecording(badHeaderPath);
    }, /schemaVersion/);
    assert.throws(() => {
      readTerminalRecording(nonObjectHeaderPath);
    }, /header is not an object/);
    assert.throws(() => {
      readTerminalRecording(missingHeaderFieldsPath);
    }, /missing required fields/);
    assert.throws(() => {
      readTerminalRecording(nonObjectLinePath);
    }, /line is not an object/);
    assert.throws(() => {
      readTerminalRecording(invalidKindPath);
    }, /kind is invalid/);
    assert.throws(() => {
      readTerminalRecording(nonFramePath);
    }, /non-frame line/);
    assert.throws(() => {
      readTerminalRecording(badAtMsPath);
    }, /atMs/);
    assert.throws(() => {
      readTerminalRecording(badFramePath);
    }, /frame shape/);
    assert.throws(() => {
      readTerminalRecording(nonObjectFramePath);
    }, /frame is not an object/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal recording writer handles stream errors without throwing from capture', async () => {
  const stream = new MemoryStream();
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-recording-error-'));
  const filePath = join(tempDir, 'unused.jsonl');
  const oracle = new TerminalSnapshotOracle(2, 1);

  try {
    const writer = createTerminalRecordingWriter({
      filePath,
      source: 'memory',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419',
      createStream: () => stream
    });

    stream.emit('error', new Error('broken stream'));
    oracle.ingest('x');
    assert.equal(writer.capture(oracle.snapshot()), false);
    await assert.rejects(writer.close(), /broken stream/);
    assert.equal(stream.content.includes('"kind":"header"'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('terminal recording writer close rejects when stream end emits error', async () => {
  const stream = new EndErrorStream();
  const writer = createTerminalRecordingWriter({
    filePath: '/dev/null',
    source: 'end-error',
    defaultForegroundHex: 'd0d7de',
    defaultBackgroundHex: '0f1419',
    createStream: () => stream
  });

  await assert.rejects(writer.close(), /end failed/);
});

void test('terminal recording writer default nowMs clock is exercised on capture', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'harness-recording-default-clock-'));
  const recordingPath = join(tempDir, 'recording.jsonl');
  const oracle = new TerminalSnapshotOracle(2, 1);

  try {
    const writer = createTerminalRecordingWriter({
      filePath: recordingPath,
      source: 'default-clock',
      defaultForegroundHex: 'd0d7de',
      defaultBackgroundHex: '0f1419'
    });
    oracle.ingest('x');
    assert.equal(writer.capture(oracle.snapshot()), true);
    await writer.close();
    const parsed = readTerminalRecording(recordingPath);
    assert.equal(parsed.frames.length, 1);
    assert.equal(parsed.frames[0]!.atMs >= 0, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
