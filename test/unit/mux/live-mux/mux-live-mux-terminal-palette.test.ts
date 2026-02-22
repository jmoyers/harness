import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { probeTerminalPalette } from '../../../../src/mux/live-mux/terminal-palette.ts';

function paletteReplySequence(): string {
  let sequence = '\u001b]10;rgb:1111/2222/3333\u0007\u001b]11;rgb:0000/1111/2222\u0007';
  for (let index = 0; index < 16; index += 1) {
    sequence += `\u001b]4;${String(index)};rgb:0101/0202/0303\u0007`;
  }
  return sequence;
}

void test('terminal palette probe resolves when foreground/background/indexed colors are received', async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalClearTimeout = globalThis.clearTimeout;
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = ((chunk: string) => {
    writes.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;
  globalThis.clearTimeout = (() => {
    return undefined as unknown as NodeJS.Timeout;
  }) as typeof clearTimeout;

  try {
    const probePromise = probeTerminalPalette(2);
    process.stdin.emit('data', Buffer.from(paletteReplySequence(), 'utf8'));
    const result = await probePromise;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(result.foregroundHex, '112233');
    assert.equal(result.backgroundHex, '001122');
    assert.equal(Object.keys(result.indexedHexByCode ?? {}).length, 16);
    assert.equal((result.indexedHexByCode ?? {})[0], '010203');
    assert.equal((result.indexedHexByCode ?? {})[15], '010203');
    assert.equal(
      writes.some((value) => value.includes('\u001b]10;?\u0007\u001b]11;?\u0007')),
      true,
    );
  } finally {
    (process.stdout as unknown as { write: typeof process.stdout.write }).write = originalWrite;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

void test('terminal palette probe returns empty result when timeout elapses without replies', async () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (() => {
    return true;
  }) as unknown as typeof process.stdout.write;
  try {
    const result = await probeTerminalPalette(1);
    assert.deepEqual(result, {});
  } finally {
    (process.stdout as unknown as { write: typeof process.stdout.write }).write = originalWrite;
  }
});
