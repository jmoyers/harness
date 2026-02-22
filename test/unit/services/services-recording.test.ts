import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RecordingService } from '../../../src/services/recording.ts';

void test('recording service closes writer when available', async () => {
  let closed = false;
  const service = new RecordingService({
    recordingWriter: {
      close: async () => {
        closed = true;
      },
    },
    recordingPath: null,
    recordingGifOutputPath: null,
    renderTerminalRecordingToGif: async () => {},
    writeStderr: () => {},
  });

  const closeError = await service.closeWriter();
  assert.equal(closeError, null);
  assert.equal(closed, true);
});

void test('recording service closeWriter returns null without writer', async () => {
  const service = new RecordingService({
    recordingWriter: null,
    recordingPath: null,
    recordingGifOutputPath: null,
    renderTerminalRecordingToGif: async () => {},
    writeStderr: () => {},
  });

  const closeError = await service.closeWriter();
  assert.equal(closeError, null);
});

void test('recording service closeWriter returns thrown error', async () => {
  const closeError = new Error('close failed');
  const service = new RecordingService({
    recordingWriter: {
      close: async () => {
        throw closeError;
      },
    },
    recordingPath: null,
    recordingGifOutputPath: null,
    renderTerminalRecordingToGif: async () => {},
    writeStderr: () => {},
  });

  assert.equal(await service.closeWriter(), closeError);
});

void test('recording service renders gif and writes success line after shutdown', async () => {
  const lines: string[] = [];
  const renders: Array<{ recordingPath: string; outputPath: string }> = [];
  const service = new RecordingService({
    recordingWriter: null,
    recordingPath: '/tmp/recording.jsonl',
    recordingGifOutputPath: '/tmp/recording.gif',
    renderTerminalRecordingToGif: async (input) => {
      renders.push(input);
    },
    writeStderr: (text) => {
      lines.push(text);
    },
  });

  await service.finalizeAfterShutdown(null);

  assert.deepEqual(renders, [
    {
      recordingPath: '/tmp/recording.jsonl',
      outputPath: '/tmp/recording.gif',
    },
  ]);
  assert.deepEqual(lines, ['[mux-recording] jsonl=/tmp/recording.jsonl gif=/tmp/recording.gif\n']);
});

void test('recording service reports gif export failures', async () => {
  const lines: string[] = [];
  const service = new RecordingService({
    recordingWriter: null,
    recordingPath: '/tmp/recording.jsonl',
    recordingGifOutputPath: '/tmp/recording.gif',
    renderTerminalRecordingToGif: async () => {
      throw new Error('gif failed');
    },
    writeStderr: (text) => {
      lines.push(text);
    },
  });

  await service.finalizeAfterShutdown(null);
  assert.deepEqual(lines, ['[mux-recording] gif-export-failed gif failed\n']);
});

void test('recording service reports close errors from Error and string values', async () => {
  const lines: string[] = [];
  const service = new RecordingService({
    recordingWriter: null,
    recordingPath: '/tmp/recording.jsonl',
    recordingGifOutputPath: '/tmp/recording.gif',
    renderTerminalRecordingToGif: async () => {},
    writeStderr: (text) => {
      lines.push(text);
    },
  });

  await service.finalizeAfterShutdown(new Error('boom'));
  await service.finalizeAfterShutdown('close string');
  assert.deepEqual(lines, [
    '[mux-recording] close-failed boom\n',
    '[mux-recording] close-failed close string\n',
  ]);
});

void test('recording service reports unknown close error and stays silent when no action is needed', async () => {
  const lines: string[] = [];
  const renders: string[] = [];
  const service = new RecordingService({
    recordingWriter: null,
    recordingPath: null,
    recordingGifOutputPath: null,
    renderTerminalRecordingToGif: async () => {
      renders.push('rendered');
    },
    writeStderr: (text) => {
      lines.push(text);
    },
  });

  await service.finalizeAfterShutdown({ reason: 'x' });
  await service.finalizeAfterShutdown(null);
  assert.deepEqual(lines, ['[mux-recording] close-failed unknown error\n']);
  assert.deepEqual(renders, []);
});
