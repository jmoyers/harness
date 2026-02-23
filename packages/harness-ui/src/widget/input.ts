export interface KeyEvent {
  readonly key: string;
  readonly raw: Buffer;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface MouseEvent {
  readonly kind: 'press' | 'release' | 'move' | 'wheel';
  readonly button: number;
  readonly col: number;
  readonly row: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly wheelDelta: number;
}

export interface PasteEvent {
  readonly text: string;
}

export type InputEvent =
  | { readonly type: 'key'; readonly event: KeyEvent }
  | { readonly type: 'mouse'; readonly event: MouseEvent }
  | { readonly type: 'paste'; readonly event: PasteEvent };

const CTRL_KEY_MAP: ReadonlyMap<number, string> = new Map([
  [0x01, 'a'],
  [0x02, 'b'],
  [0x03, 'c'],
  [0x04, 'd'],
  [0x05, 'e'],
  [0x06, 'f'],
  [0x07, 'g'],
  [0x08, 'backspace'],
  [0x09, 'tab'],
  [0x0a, 'enter'],
  [0x0b, 'k'],
  [0x0c, 'l'],
  [0x0d, 'enter'],
  [0x0e, 'n'],
  [0x0f, 'o'],
  [0x10, 'p'],
  [0x11, 'q'],
  [0x12, 'r'],
  [0x13, 's'],
  [0x14, 't'],
  [0x15, 'u'],
  [0x16, 'v'],
  [0x17, 'w'],
  [0x18, 'x'],
  [0x19, 'y'],
  [0x1a, 'z'],
]);

const ESCAPE_KEY_MAP: ReadonlyMap<string, string> = new Map([
  ['[A', 'up'],
  ['[B', 'down'],
  ['[C', 'right'],
  ['[D', 'left'],
  ['[H', 'home'],
  ['[F', 'end'],
  ['[2~', 'insert'],
  ['[3~', 'delete'],
  ['[5~', 'pageup'],
  ['[6~', 'pagedown'],
  ['[Z', 'shift+tab'],
  ['OP', 'f1'],
  ['OQ', 'f2'],
  ['OR', 'f3'],
  ['OS', 'f4'],
  ['[15~', 'f5'],
  ['[17~', 'f6'],
  ['[18~', 'f7'],
  ['[19~', 'f8'],
  ['[20~', 'f9'],
  ['[21~', 'f10'],
  ['[23~', 'f11'],
  ['[24~', 'f12'],
]);

function keyEvent(key: string, raw: Buffer, ctrl = false, alt = false, shift = false): KeyEvent {
  return { key, raw, ctrl, alt, shift };
}

export function parseKeyInput(data: Buffer): KeyEvent | null {
  if (data.length === 0) return null;

  if (data.length === 1) {
    const byte = data[0]!;

    if (byte === 0x1b) return keyEvent('escape', data);
    if (byte === 0x7f) return keyEvent('backspace', data);

    if (byte >= 0x01 && byte <= 0x1a) {
      const mapped = CTRL_KEY_MAP.get(byte);
      if (mapped === 'enter' || mapped === 'tab' || mapped === 'backspace') {
        return keyEvent(mapped, data);
      }
      return keyEvent(mapped ?? String.fromCharCode(byte + 0x60), data, true);
    }

    if (byte >= 0x20 && byte < 0x7f) {
      const char = String.fromCharCode(byte);
      return keyEvent(char, data, false, false, char >= 'A' && char <= 'Z');
    }

    return null;
  }

  const text = data.toString('utf8');

  if (text.startsWith('\x1b') && text.length === 2) {
    const char = text[1]!;
    return keyEvent(char, data, false, true);
  }

  if (text.startsWith('\x1b')) {
    const seq = text.slice(1);
    const mapped = ESCAPE_KEY_MAP.get(seq);
    if (mapped !== undefined) {
      if (mapped === 'shift+tab') return keyEvent('tab', data, false, false, true);
      return keyEvent(mapped, data);
    }

    const csiMatch = seq.match(/^\[(\d+)(?:;(\d+))?([A-Z~])$/);
    if (csiMatch !== null) {
      const param1 = parseInt(csiMatch[1]!, 10);
      const param2 = csiMatch[2] !== undefined ? parseInt(csiMatch[2], 10) : 0;
      const final = csiMatch[3]!;

      if (param2 > 0) {
        const mod = param2 - 1;
        const shift = (mod & 1) !== 0;
        const alt = (mod & 2) !== 0;
        const ctrl = (mod & 4) !== 0;

        let baseKey: string | null = null;
        if (final === 'A') baseKey = 'up';
        else if (final === 'B') baseKey = 'down';
        else if (final === 'C') baseKey = 'right';
        else if (final === 'D') baseKey = 'left';
        else if (final === 'H') baseKey = 'home';
        else if (final === 'F') baseKey = 'end';
        else if (final === '~') {
          if (param1 === 2) baseKey = 'insert';
          else if (param1 === 3) baseKey = 'delete';
          else if (param1 === 5) baseKey = 'pageup';
          else if (param1 === 6) baseKey = 'pagedown';
        }

        if (baseKey !== null) return keyEvent(baseKey, data, ctrl, alt, shift);
      }
    }
  }

  if (!text.startsWith('\x1b') && text.length > 0) {
    return keyEvent(text, data);
  }

  return null;
}

export function parseSgrMouse(data: Buffer): MouseEvent | null {
  const text = data.toString('utf8');
  if (!text.startsWith('\u001b[<')) return null;
  const match = text.slice(3).match(/^(\d+);(\d+);(\d+)([Mm])$/);
  if (match === null) return null;

  const code = parseInt(match[1]!, 10);
  const col = parseInt(match[2]!, 10);
  const row = parseInt(match[3]!, 10);
  const final = match[4]!;

  const shift = (code & 4) !== 0;
  const alt = (code & 8) !== 0;
  const ctrl = (code & 16) !== 0;
  const baseButton = code & 3;
  const isMotion = (code & 32) !== 0;
  const isWheel = (code & 64) !== 0;

  if (isWheel) {
    return {
      kind: 'wheel',
      button: baseButton,
      col,
      row,
      ctrl,
      alt,
      shift,
      wheelDelta: baseButton === 0 ? -1 : 1,
    };
  }

  if (final === 'm') {
    return { kind: 'release', button: baseButton, col, row, ctrl, alt, shift, wheelDelta: 0 };
  }

  if (isMotion) {
    return { kind: 'move', button: baseButton, col, row, ctrl, alt, shift, wheelDelta: 0 };
  }

  return { kind: 'press', button: baseButton, col, row, ctrl, alt, shift, wheelDelta: 0 };
}

export function parseInput(data: Buffer): InputEvent | null {
  const mouse = parseSgrMouse(data);
  if (mouse !== null) return { type: 'mouse', event: mouse };

  const key = parseKeyInput(data);
  if (key !== null) return { type: 'key', event: key };

  return null;
}

export type InputHandler = (event: InputEvent) => boolean;
