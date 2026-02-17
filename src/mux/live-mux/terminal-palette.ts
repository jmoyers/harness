import { extractOscColorReplies } from './palette-parsing.ts';

export async function probeTerminalPalette(timeoutMs = 80): Promise<{
  foregroundHex?: string;
  backgroundHex?: string;
  indexedHexByCode?: Record<number, string>;
}> {
  return await new Promise((resolve) => {
    let finished = false;
    let buffer = '';
    let foregroundHex: string | undefined;
    let backgroundHex: string | undefined;
    const indexedHexByCode: Record<number, string> = {};

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      resolve({
        ...(foregroundHex !== undefined
          ? {
              foregroundHex,
            }
          : {}),
        ...(backgroundHex !== undefined
          ? {
              backgroundHex,
            }
          : {}),
        ...(Object.keys(indexedHexByCode).length > 0
          ? {
              indexedHexByCode,
            }
          : {}),
      });
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const extracted = extractOscColorReplies(buffer);
      buffer = extracted.remainder;

      if (extracted.foregroundHex !== undefined) {
        foregroundHex = extracted.foregroundHex;
      }
      if (extracted.backgroundHex !== undefined) {
        backgroundHex = extracted.backgroundHex;
      }
      for (const [key, value] of Object.entries(extracted.indexedHexByCode)) {
        const index = Number.parseInt(key, 10);
        if (Number.isInteger(index)) {
          indexedHexByCode[index] = value;
        }
      }

      if (
        foregroundHex !== undefined &&
        backgroundHex !== undefined &&
        Object.keys(indexedHexByCode).length >= 16
      ) {
        finish();
      }
    };

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    process.stdin.on('data', onData);
    let probeSequence = '\u001b]10;?\u0007\u001b]11;?\u0007';
    for (let idx = 0; idx < 16; idx += 1) {
      probeSequence += `\u001b]4;${String(idx)};?\u0007`;
    }
    process.stdout.write(probeSequence);
  });
}
