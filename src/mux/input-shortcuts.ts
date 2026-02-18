type MuxGlobalShortcutAction =
  | 'mux.app.quit'
  | 'mux.app.interrupt-all'
  | 'mux.gateway.profile.toggle'
  | 'mux.gateway.status-timeline.toggle'
  | 'mux.gateway.render-trace.toggle'
  | 'mux.conversation.new'
  | 'mux.conversation.critique.open-or-create'
  | 'mux.conversation.next'
  | 'mux.conversation.previous'
  | 'mux.conversation.interrupt'
  | 'mux.conversation.archive'
  | 'mux.conversation.takeover'
  | 'mux.conversation.delete'
  | 'mux.directory.add'
  | 'mux.directory.close';

interface KeyStroke {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

interface ParsedShortcutBinding {
  readonly stroke: KeyStroke;
  readonly originalText: string;
}

interface ResolvedMuxShortcutBindings {
  readonly rawByAction: Readonly<Record<MuxGlobalShortcutAction, readonly string[]>>;
  readonly parsedByAction: Readonly<
    Record<MuxGlobalShortcutAction, readonly ParsedShortcutBinding[]>
  >;
}

const ACTION_ORDER: readonly MuxGlobalShortcutAction[] = [
  'mux.app.quit',
  'mux.app.interrupt-all',
  'mux.gateway.profile.toggle',
  'mux.gateway.status-timeline.toggle',
  'mux.gateway.render-trace.toggle',
  'mux.conversation.new',
  'mux.conversation.critique.open-or-create',
  'mux.conversation.next',
  'mux.conversation.previous',
  'mux.conversation.interrupt',
  'mux.conversation.archive',
  'mux.conversation.takeover',
  'mux.conversation.delete',
  'mux.directory.add',
  'mux.directory.close',
];

const DEFAULT_MUX_SHORTCUT_BINDINGS_RAW: Readonly<
  Record<MuxGlobalShortcutAction, readonly string[]>
> = {
  'mux.app.quit': [],
  'mux.app.interrupt-all': ['ctrl+c'],
  'mux.gateway.profile.toggle': ['ctrl+p'],
  'mux.gateway.status-timeline.toggle': ['alt+r'],
  'mux.gateway.render-trace.toggle': ['ctrl+]'],
  'mux.conversation.new': ['ctrl+t'],
  'mux.conversation.critique.open-or-create': ['ctrl+g'],
  'mux.conversation.next': ['ctrl+j'],
  'mux.conversation.previous': ['ctrl+k'],
  'mux.conversation.interrupt': [],
  'mux.conversation.archive': [],
  'mux.conversation.takeover': ['ctrl+l'],
  'mux.conversation.delete': ['ctrl+x'],
  'mux.directory.add': ['ctrl+o'],
  'mux.directory.close': ['ctrl+w'],
};

const KEY_TOKEN_ALIASES = new Map<string, string>([
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['meta', 'meta'],
  ['super', 'meta'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['shift', 'shift'],
  ['esc', 'escape'],
  ['return', 'enter'],
  ['spacebar', 'space'],
]);

function parseNumericPrefix(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function decodeModifiers(modifierCode: number): Omit<KeyStroke, 'key'> | null {
  if (modifierCode <= 0) {
    return null;
  }
  const mask = modifierCode - 1;
  return {
    shift: (mask & 0b0001) !== 0,
    alt: (mask & 0b0010) !== 0,
    ctrl: (mask & 0b0100) !== 0,
    meta: (mask & 0b1000) !== 0,
  };
}

function keyNameFromKeyCode(keyCode: number): string | null {
  if (keyCode < 0) {
    return null;
  }
  if (keyCode === 13) {
    return 'enter';
  }
  if (keyCode === 9) {
    return 'tab';
  }
  if (keyCode === 27) {
    return 'escape';
  }
  if (keyCode === 32) {
    return 'space';
  }
  if (keyCode >= 33 && keyCode <= 126) {
    return String.fromCharCode(keyCode).toLowerCase();
  }
  return null;
}

function controlByteToKeyStroke(byte: number): KeyStroke | null {
  if (byte === 0x1b) {
    return {
      key: 'escape',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x0d) {
    return {
      key: 'enter',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x09) {
    return {
      key: 'tab',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x20) {
    return {
      key: 'space',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }

  if (byte >= 0x01 && byte <= 0x1a) {
    return {
      key: String.fromCharCode(byte + 96),
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
  }

  if (byte === 0x1c) {
    return {
      key: '\\',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x1d) {
    return {
      key: ']',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x1e) {
    return {
      key: '^',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x1f) {
    return {
      key: '_',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    };
  }

  if (byte >= 32 && byte <= 126) {
    const char = String.fromCharCode(byte);
    const lower = char.toLowerCase();
    const isUpper = char !== lower;
    return {
      key: lower,
      ctrl: false,
      alt: false,
      shift: isUpper,
      meta: false,
    };
  }

  return null;
}

function parseKittyKeyboardProtocol(text: string): KeyStroke | null {
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
  const key = keyNameFromKeyCode(keyCode);
  if (key === null) {
    return null;
  }

  const modifierCode = params.length >= 2 ? parseNumericPrefix(params[1]!.split(':')[0]!) : 1;
  if (modifierCode === null) {
    return null;
  }
  const modifiers = decodeModifiers(modifierCode);
  if (modifiers === null) {
    return null;
  }

  return {
    key,
    ...modifiers,
  };
}

function parseModifyOtherKeysProtocol(text: string): KeyStroke | null {
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
  if (modifierCode === null || keyCode === null) {
    return null;
  }
  const modifiers = decodeModifiers(modifierCode);
  const key = keyNameFromKeyCode(keyCode);
  if (modifiers === null || key === null) {
    return null;
  }

  return {
    key,
    ...modifiers,
  };
}

function parseAltPrefixInput(input: Buffer): KeyStroke | null {
  if (input.length !== 2 || input[0] !== 0x1b) {
    return null;
  }
  const inner = controlByteToKeyStroke(input[1]!);
  if (inner === null) {
    return null;
  }
  return {
    key: inner.key,
    ctrl: inner.ctrl,
    alt: true,
    shift: inner.shift,
    meta: inner.meta,
  };
}

function decodeInputToKeyStroke(input: Buffer): KeyStroke | null {
  if (input.length === 1) {
    return controlByteToKeyStroke(input[0]!);
  }

  const altPrefixed = parseAltPrefixInput(input);
  if (altPrefixed !== null) {
    return altPrefixed;
  }

  const text = input.toString('utf8');
  const kitty = parseKittyKeyboardProtocol(text);
  if (kitty !== null) {
    return kitty;
  }

  return parseModifyOtherKeysProtocol(text);
}

function keyStrokeToLegacyBytes(stroke: KeyStroke): Buffer | null {
  if (stroke.key === 'enter' && stroke.shift) {
    // Preserve Shift+Enter protocol bytes so apps that differentiate it (for newline vs submit)
    // can handle it; collapsing to CR loses intent.
    return null;
  }
  let base: Buffer | null = null;
  if (stroke.ctrl) {
    if (stroke.key === 'space') {
      base = Buffer.from([0x00]);
    } else if (stroke.key === 'enter') {
      base = Buffer.from([0x0d]);
    } else if (stroke.key === 'tab') {
      base = Buffer.from([0x09]);
    } else if (stroke.key === 'escape') {
      base = Buffer.from([0x1b]);
    } else if (stroke.key.length === 1) {
      const key = stroke.key.toLowerCase();
      const code = key.charCodeAt(0);
      if (code >= 97 && code <= 122) {
        base = Buffer.from([code - 96]);
      } else if (key === '@') {
        base = Buffer.from([0x00]);
      } else if (key === '[') {
        base = Buffer.from([0x1b]);
      } else if (key === '\\') {
        base = Buffer.from([0x1c]);
      } else if (key === ']') {
        base = Buffer.from([0x1d]);
      } else if (key === '^') {
        base = Buffer.from([0x1e]);
      } else if (key === '_') {
        base = Buffer.from([0x1f]);
      } else if (key === '?') {
        base = Buffer.from([0x7f]);
      }
    }
  } else if (stroke.key === 'enter') {
    base = Buffer.from([0x0d]);
  } else if (stroke.key === 'tab') {
    base = Buffer.from([0x09]);
  } else if (stroke.key === 'escape') {
    base = Buffer.from([0x1b]);
  } else if (stroke.key === 'space') {
    base = Buffer.from([0x20]);
  } else if (stroke.key.length === 1) {
    const key =
      stroke.shift && stroke.key >= 'a' && stroke.key <= 'z'
        ? stroke.key.toUpperCase()
        : stroke.key;
    base = Buffer.from(key, 'utf8');
  }

  if (base === null) {
    return null;
  }
  if (!stroke.alt && !stroke.meta) {
    return base;
  }
  return Buffer.concat([Buffer.from([0x1b]), base]);
}

function decodeEncodedKeystrokeSequence(sequence: string): Buffer | null {
  const decodedStroke =
    parseKittyKeyboardProtocol(sequence) ?? parseModifyOtherKeysProtocol(sequence);
  if (decodedStroke === null) {
    return null;
  }
  return keyStrokeToLegacyBytes(decodedStroke);
}

export function normalizeMuxKeyboardInputForPty(input: Buffer): Buffer {
  if (!input.includes(0x1b)) {
    return input;
  }
  const text = input.toString('utf8');
  const parts: Buffer[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor]!;
    if (char !== '\u001b' || text[cursor + 1] !== '[') {
      parts.push(Buffer.from(char, 'utf8'));
      cursor += 1;
      continue;
    }

    let matchedSequence: string | null = null;
    let idx = cursor + 2;
    while (idx < text.length) {
      const tokenChar = text[idx]!;
      const isDigit = tokenChar >= '0' && tokenChar <= '9';
      if (isDigit || tokenChar === ';' || tokenChar === ':') {
        idx += 1;
        continue;
      }
      if (tokenChar === 'u' || tokenChar === '~') {
        const candidate = text.slice(cursor, idx + 1);
        const decoded = decodeEncodedKeystrokeSequence(candidate);
        if (decoded !== null) {
          parts.push(decoded);
          matchedSequence = candidate;
        }
      }
      break;
    }

    if (matchedSequence !== null) {
      cursor += matchedSequence.length;
      continue;
    }

    parts.push(Buffer.from('\u001b', 'utf8'));
    cursor += 1;
  }
  return Buffer.concat(parts);
}

function normalizeKeyToken(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }
  return KEY_TOKEN_ALIASES.get(key) ?? key;
}

function parseShortcutBinding(input: string): ParsedShortcutBinding | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  const rawParts = trimmed.split('+');

  const tokens = rawParts
    .map((part) => normalizeKeyToken(part))
    .flatMap((token) => (token === null ? [] : [token]));
  if (tokens.length === 0) {
    return null;
  }

  const modifiers = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };

  for (let idx = 0; idx < tokens.length - 1; idx += 1) {
    const token = tokens[idx]!;
    if (token === 'ctrl') {
      modifiers.ctrl = true;
      continue;
    }
    if (token === 'alt') {
      modifiers.alt = true;
      continue;
    }
    if (token === 'shift') {
      modifiers.shift = true;
      continue;
    }
    if (token === 'meta') {
      modifiers.meta = true;
      continue;
    }
    return null;
  }

  const key = tokens[tokens.length - 1]!;
  const validNamedKeys = new Set([
    'enter',
    'tab',
    'escape',
    'space',
    'up',
    'down',
    'left',
    'right',
    'home',
    'end',
    'pageup',
    'pagedown',
  ]);
  if (key.length !== 1 && !validNamedKeys.has(key)) {
    return null;
  }

  return {
    stroke: {
      key,
      ...modifiers,
    },
    originalText: trimmed,
  };
}

function strokesEqual(left: KeyStroke, right: KeyStroke): boolean {
  return (
    left.key === right.key &&
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta
  );
}

function parseBindingsForAction(rawBindings: readonly string[]): readonly ParsedShortcutBinding[] {
  const parsed: ParsedShortcutBinding[] = [];
  for (const raw of rawBindings) {
    const normalized = parseShortcutBinding(raw);
    if (normalized !== null) {
      parsed.push(normalized);
    }
  }
  return parsed;
}

function withDefaultBindings(
  overrides: Readonly<Record<string, readonly string[]> | undefined>,
): Readonly<Record<MuxGlobalShortcutAction, readonly string[]>> {
  return {
    'mux.app.quit':
      overrides?.['mux.app.quit'] ?? DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.app.quit'],
    'mux.app.interrupt-all':
      overrides?.['mux.app.interrupt-all'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.app.interrupt-all'],
    'mux.gateway.profile.toggle':
      overrides?.['mux.gateway.profile.toggle'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.profile.toggle'],
    'mux.gateway.status-timeline.toggle':
      overrides?.['mux.gateway.status-timeline.toggle'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.status-timeline.toggle'],
    'mux.gateway.render-trace.toggle':
      overrides?.['mux.gateway.render-trace.toggle'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.render-trace.toggle'],
    'mux.conversation.new':
      overrides?.['mux.conversation.new'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.new'],
    'mux.conversation.critique.open-or-create':
      overrides?.['mux.conversation.critique.open-or-create'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.critique.open-or-create'],
    'mux.conversation.next':
      overrides?.['mux.conversation.next'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.next'],
    'mux.conversation.previous':
      overrides?.['mux.conversation.previous'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.previous'],
    'mux.conversation.interrupt':
      overrides?.['mux.conversation.interrupt'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.interrupt'],
    'mux.conversation.archive':
      overrides?.['mux.conversation.archive'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.archive'],
    'mux.conversation.takeover':
      overrides?.['mux.conversation.takeover'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.takeover'],
    'mux.conversation.delete':
      overrides?.['mux.conversation.delete'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.delete'],
    'mux.directory.add':
      overrides?.['mux.directory.add'] ?? DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.directory.add'],
    'mux.directory.close':
      overrides?.['mux.directory.close'] ??
      DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.directory.close'],
  };
}

export function resolveMuxShortcutBindings(
  overrides?: Readonly<Record<string, readonly string[]> | undefined>,
): ResolvedMuxShortcutBindings {
  const rawByAction = withDefaultBindings(overrides);
  return {
    rawByAction,
    parsedByAction: {
      'mux.app.quit': parseBindingsForAction(rawByAction['mux.app.quit']),
      'mux.app.interrupt-all': parseBindingsForAction(rawByAction['mux.app.interrupt-all']),
      'mux.gateway.profile.toggle': parseBindingsForAction(
        rawByAction['mux.gateway.profile.toggle'],
      ),
      'mux.gateway.status-timeline.toggle': parseBindingsForAction(
        rawByAction['mux.gateway.status-timeline.toggle'],
      ),
      'mux.gateway.render-trace.toggle': parseBindingsForAction(
        rawByAction['mux.gateway.render-trace.toggle'],
      ),
      'mux.conversation.new': parseBindingsForAction(rawByAction['mux.conversation.new']),
      'mux.conversation.critique.open-or-create': parseBindingsForAction(
        rawByAction['mux.conversation.critique.open-or-create'],
      ),
      'mux.conversation.next': parseBindingsForAction(rawByAction['mux.conversation.next']),
      'mux.conversation.previous': parseBindingsForAction(rawByAction['mux.conversation.previous']),
      'mux.conversation.interrupt': parseBindingsForAction(
        rawByAction['mux.conversation.interrupt'],
      ),
      'mux.conversation.archive': parseBindingsForAction(rawByAction['mux.conversation.archive']),
      'mux.conversation.takeover': parseBindingsForAction(rawByAction['mux.conversation.takeover']),
      'mux.conversation.delete': parseBindingsForAction(rawByAction['mux.conversation.delete']),
      'mux.directory.add': parseBindingsForAction(rawByAction['mux.directory.add']),
      'mux.directory.close': parseBindingsForAction(rawByAction['mux.directory.close']),
    },
  };
}

const DEFAULT_SHORTCUT_BINDINGS = resolveMuxShortcutBindings();

export function firstShortcutText(
  bindings: ResolvedMuxShortcutBindings,
  action: MuxGlobalShortcutAction,
): string {
  return bindings.rawByAction[action][0] ?? '';
}

export function detectMuxGlobalShortcut(
  input: Buffer,
  bindings: ResolvedMuxShortcutBindings = DEFAULT_SHORTCUT_BINDINGS,
): MuxGlobalShortcutAction | null {
  const stroke = decodeInputToKeyStroke(input);
  if (stroke === null) {
    return null;
  }

  for (const action of ACTION_ORDER) {
    const match = bindings.parsedByAction[action].some((binding) =>
      strokesEqual(binding.stroke, stroke),
    );
    if (match) {
      return action;
    }
  }
  return null;
}
