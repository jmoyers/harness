export function parseOscRgbHex(value: string): string | null {
  if (!value.startsWith('rgb:')) {
    return null;
  }

  const components = value.slice(4).split('/');
  if (components.length !== 3) {
    return null;
  }

  const bytes: string[] = [];
  for (const component of components) {
    const normalized = component.trim();
    if (normalized.length < 1 || normalized.length > 4) {
      return null;
    }
    if (!/^[0-9a-fA-F]+$/.test(normalized)) {
      return null;
    }

    const raw = Number.parseInt(normalized, 16);
    const max = (1 << (normalized.length * 4)) - 1;
    const scaled = Math.round((raw * 255) / max);
    bytes.push(scaled.toString(16).padStart(2, '0'));
  }

  return `${bytes[0]}${bytes[1]}${bytes[2]}`;
}

export function extractOscColorReplies(buffer: string): {
  readonly remainder: string;
  readonly foregroundHex?: string;
  readonly backgroundHex?: string;
  readonly indexedHexByCode: Record<number, string>;
} {
  let remainder = buffer;
  let foregroundHex: string | undefined;
  let backgroundHex: string | undefined;
  const indexedHexByCode: Record<number, string> = {};

  while (true) {
    const start = remainder.indexOf('\u001b]');
    if (start < 0) {
      break;
    }
    if (start > 0) {
      remainder = remainder.slice(start);
    }

    const bellTerminator = remainder.indexOf('\u0007', 2);
    const stTerminator = remainder.indexOf('\u001b\\', 2);
    let end = -1;
    let terminatorLength = 0;

    if (bellTerminator >= 0 && (stTerminator < 0 || bellTerminator < stTerminator)) {
      end = bellTerminator;
      terminatorLength = 1;
    } else if (stTerminator >= 0) {
      end = stTerminator;
      terminatorLength = 2;
    }

    if (end < 0) {
      break;
    }

    const payload = remainder.slice(2, end);
    remainder = remainder.slice(end + terminatorLength);
    const separator = payload.indexOf(';');
    if (separator < 0) {
      continue;
    }

    const code = payload.slice(0, separator);
    if (code === '10') {
      const hex = parseOscRgbHex(payload.slice(separator + 1));
      if (hex !== null) {
        foregroundHex = hex;
      }
      continue;
    }

    if (code === '11') {
      const hex = parseOscRgbHex(payload.slice(separator + 1));
      if (hex !== null) {
        backgroundHex = hex;
      }
      continue;
    }

    if (code === '4') {
      const value = payload.slice(separator + 1);
      const paletteSeparator = value.indexOf(';');
      if (paletteSeparator < 0) {
        continue;
      }
      const paletteIndexRaw = value.slice(0, paletteSeparator).trim();
      const paletteValueRaw = value.slice(paletteSeparator + 1);
      if (!/^\d+$/u.test(paletteIndexRaw)) {
        continue;
      }
      const parsedIndex = Number.parseInt(paletteIndexRaw, 10);
      if (parsedIndex < 0 || parsedIndex > 255) {
        continue;
      }
      const hex = parseOscRgbHex(paletteValueRaw);
      if (hex !== null) {
        indexedHexByCode[parsedIndex] = hex;
      }
    }
  }

  if (remainder.length > 512) {
    remainder = remainder.slice(-512);
  }

  return {
    remainder,
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
    indexedHexByCode,
  };
}
