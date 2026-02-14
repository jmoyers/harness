type MuxGlobalShortcutAction =
  | 'quit'
  | 'ctrl-c'
  | 'new-conversation'
  | 'next-conversation'
  | 'previous-conversation';

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function parseNumericPrefix(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return isFiniteInteger(parsed) ? parsed : null;
}

function hasCtrlModifier(modifierCode: number): boolean {
  if (!isFiniteInteger(modifierCode) || modifierCode <= 0) {
    return false;
  }
  return ((modifierCode - 1) & 0b0100) !== 0;
}

function mapRawControlByteToAction(asciiCode: number): MuxGlobalShortcutAction | null {
  if (asciiCode === 0x03) {
    return 'ctrl-c';
  }
  if (asciiCode === 0x14) {
    return 'new-conversation';
  }
  if (asciiCode === 0x0e) {
    return 'next-conversation';
  }
  if (asciiCode === 0x10) {
    return 'previous-conversation';
  }
  if (asciiCode === 0x1d) {
    return 'quit';
  }
  return null;
}

function mapCtrlKeyCodeToAction(asciiCode: number): MuxGlobalShortcutAction | null {
  if (asciiCode === 99) {
    return 'ctrl-c';
  }
  if (asciiCode === 93) {
    return 'quit';
  }
  if (asciiCode === 116) {
    return 'new-conversation';
  }
  if (asciiCode === 110) {
    return 'next-conversation';
  }
  if (asciiCode === 112) {
    return 'previous-conversation';
  }
  return null;
}

function parseKittyKeyboardProtocol(text: string): MuxGlobalShortcutAction | null {
  if (!text.startsWith('\u001b[') || !text.endsWith('u')) {
    return null;
  }

  const payload = text.slice(2, -1);
  const params = payload.split(';');
  if (params.length > 3) {
    return null;
  }

  const keyCode = parseNumericPrefix(params[0]!.split(':')[0]!);
  if (keyCode === null) {
    return null;
  }

  const modifierCode = params.length >= 2 ? parseNumericPrefix(params[1]!.split(':')[0]!) : 1;
  if (modifierCode === null || !hasCtrlModifier(modifierCode)) {
    return null;
  }

  return mapCtrlKeyCodeToAction(keyCode);
}

function parseModifyOtherKeysProtocol(text: string): MuxGlobalShortcutAction | null {
  if (!text.startsWith('\u001b[27;') || !text.endsWith('~')) {
    return null;
  }

  const payload = text.slice('\u001b['.length, -1);
  const params = payload.split(';');
  if (params.length !== 3) {
    return null;
  }

  const modifierCode = parseNumericPrefix(params[1]!);
  const keyCode = parseNumericPrefix(params[2]!);
  if (modifierCode === null || keyCode === null || !hasCtrlModifier(modifierCode)) {
    return null;
  }

  return mapCtrlKeyCodeToAction(keyCode);
}

export function detectMuxGlobalShortcut(input: Buffer): MuxGlobalShortcutAction | null {
  if (input.length === 1) {
    return mapRawControlByteToAction(input[0]!);
  }

  const text = input.toString('utf8');
  const kitty = parseKittyKeyboardProtocol(text);
  if (kitty !== null) {
    return kitty;
  }

  return parseModifyOtherKeysProtocol(text);
}
