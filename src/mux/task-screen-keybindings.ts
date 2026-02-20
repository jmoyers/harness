interface KeyStroke {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

interface ParsedBinding {
  readonly stroke: KeyStroke;
  readonly originalText: string;
}

export type TaskScreenKeybindingAction =
  | 'mux.home.repo.dropdown.toggle'
  | 'mux.home.repo.next'
  | 'mux.home.repo.previous'
  | 'mux.home.task.submit'
  | 'mux.home.task.queue'
  | 'mux.home.task.newline'
  | 'mux.home.task.status.ready'
  | 'mux.home.task.status.draft'
  | 'mux.home.task.status.complete'
  | 'mux.home.task.reorder.up'
  | 'mux.home.task.reorder.down'
  | 'mux.home.editor.cursor.left'
  | 'mux.home.editor.cursor.right'
  | 'mux.home.editor.cursor.up'
  | 'mux.home.editor.cursor.down'
  | 'mux.home.editor.line.start'
  | 'mux.home.editor.line.end'
  | 'mux.home.editor.word.left'
  | 'mux.home.editor.word.right'
  | 'mux.home.editor.delete.backward'
  | 'mux.home.editor.delete.forward'
  | 'mux.home.editor.delete.word.backward'
  | 'mux.home.editor.delete.line.start'
  | 'mux.home.editor.delete.line.end';

const ACTION_ORDER: readonly TaskScreenKeybindingAction[] = [
  'mux.home.repo.dropdown.toggle',
  'mux.home.repo.next',
  'mux.home.repo.previous',
  'mux.home.task.submit',
  'mux.home.task.queue',
  'mux.home.task.newline',
  'mux.home.task.status.ready',
  'mux.home.task.status.draft',
  'mux.home.task.status.complete',
  'mux.home.task.reorder.up',
  'mux.home.task.reorder.down',
  'mux.home.editor.cursor.left',
  'mux.home.editor.cursor.right',
  'mux.home.editor.cursor.up',
  'mux.home.editor.cursor.down',
  'mux.home.editor.line.start',
  'mux.home.editor.line.end',
  'mux.home.editor.word.left',
  'mux.home.editor.word.right',
  'mux.home.editor.delete.backward',
  'mux.home.editor.delete.forward',
  'mux.home.editor.delete.word.backward',
  'mux.home.editor.delete.line.start',
  'mux.home.editor.delete.line.end',
] as const;

export const DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW: Readonly<
  Record<TaskScreenKeybindingAction, readonly string[]>
> = {
  'mux.home.repo.dropdown.toggle': ['alt+g'],
  'mux.home.repo.next': ['ctrl+n'],
  'mux.home.repo.previous': ['ctrl+p'],
  'mux.home.task.submit': ['enter'],
  'mux.home.task.queue': ['tab'],
  'mux.home.task.newline': ['shift+enter'],
  'mux.home.task.status.ready': ['alt+r'],
  'mux.home.task.status.draft': ['alt+d'],
  'mux.home.task.status.complete': ['alt+c'],
  'mux.home.task.reorder.up': ['ctrl+up'],
  'mux.home.task.reorder.down': ['ctrl+down'],
  'mux.home.editor.cursor.left': ['left', 'ctrl+b'],
  'mux.home.editor.cursor.right': ['right', 'ctrl+f'],
  'mux.home.editor.cursor.up': ['up'],
  'mux.home.editor.cursor.down': ['down'],
  'mux.home.editor.line.start': ['ctrl+a', 'home'],
  'mux.home.editor.line.end': ['ctrl+e', 'end'],
  'mux.home.editor.word.left': ['alt+b'],
  'mux.home.editor.word.right': ['alt+f'],
  'mux.home.editor.delete.backward': ['backspace'],
  'mux.home.editor.delete.forward': ['delete'],
  'mux.home.editor.delete.word.backward': ['ctrl+w', 'alt+backspace'],
  'mux.home.editor.delete.line.start': ['ctrl+u'],
  'mux.home.editor.delete.line.end': ['ctrl+k'],
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
  ['del', 'delete'],
  ['bs', 'backspace'],
]);

const SUPPORTED_NAMED_KEYS = new Set([
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
  'delete',
  'backspace',
]);

export interface ResolvedTaskScreenKeybindings {
  readonly rawByAction: Readonly<Record<TaskScreenKeybindingAction, readonly string[]>>;
  readonly parsedByAction: Readonly<Record<TaskScreenKeybindingAction, readonly ParsedBinding[]>>;
}

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

function keyNameFromKeyCode(code: number): string | null {
  if (code === 13) {
    return 'enter';
  }
  if (code === 9) {
    return 'tab';
  }
  if (code === 27) {
    return 'escape';
  }
  if (code === 32) {
    return 'space';
  }
  if (code === 127) {
    return 'backspace';
  }
  if (code >= 33 && code <= 126) {
    return String.fromCharCode(code).toLowerCase();
  }
  return null;
}

function decodeSingleByte(byte: number): KeyStroke | null {
  if (byte === 0x1b) {
    return {
      key: 'escape',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }
  if (byte === 0x0d || byte === 0x0a) {
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
  if (byte === 0x7f || byte === 0x08) {
    return {
      key: 'backspace',
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
  if (byte >= 32 && byte <= 126) {
    const char = String.fromCharCode(byte);
    const lower = char.toLowerCase();
    return {
      key: lower,
      ctrl: false,
      alt: false,
      shift: char !== lower,
      meta: false,
    };
  }
  return null;
}

function parseAltPrefix(input: Buffer): KeyStroke | null {
  if (input.length !== 2 || input[0] !== 0x1b) {
    return null;
  }
  const inner = decodeSingleByte(input[1]!);
  if (inner === null) {
    return null;
  }
  return {
    ...inner,
    alt: true,
  };
}

function parseKitty(input: string): KeyStroke | null {
  if (!input.startsWith('\u001b[') || !input.endsWith('u')) {
    return null;
  }
  const payload = input.slice(2, -1);
  const match = payload.match(/^(\d+)(?::\d+)?(?:;(\d+)(?::\d+)?)?$/u);
  if (match === null) {
    return null;
  }
  const keyCode = parseNumericPrefix(match[1]!)!;
  const modifiers = decodeModifiers(parseNumericPrefix(match[2] ?? '1') ?? -1);
  const key = keyNameFromKeyCode(keyCode);
  if (modifiers === null || key === null) {
    return null;
  }
  return {
    key,
    ...modifiers,
  };
}

function parseModifyOtherKeys(input: string): KeyStroke | null {
  if (!input.startsWith('\u001b[') || !input.endsWith('~')) {
    return null;
  }
  const payload = input.slice(2, -1);
  const match = payload.match(/^27;(\d+);(\d+)$/u);
  if (match === null) {
    return null;
  }
  const modifiers = decodeModifiers(parseNumericPrefix(match[1]!) ?? -1);
  const key = keyNameFromKeyCode(parseNumericPrefix(match[2]!) ?? -1);
  if (modifiers === null || key === null) {
    return null;
  }
  return {
    key,
    ...modifiers,
  };
}

function csiDirectionKeyFromSuffix(suffix: 'A' | 'B' | 'C' | 'D' | 'H' | 'F'): string {
  if (suffix === 'A') {
    return 'up';
  }
  if (suffix === 'B') {
    return 'down';
  }
  if (suffix === 'C') {
    return 'right';
  }
  if (suffix === 'D') {
    return 'left';
  }
  if (suffix === 'H') {
    return 'home';
  }
  return 'end';
}

function parseCsi(input: string): KeyStroke | null {
  if (!input.startsWith('\u001b[') || input.length < 3) {
    return null;
  }
  const payload = input.slice(2);
  const directionMatch = payload.match(/^(?:(\d+);(\d+)|1;(\d+))?([ABCDHF])$/u);
  if (directionMatch !== null) {
    const key = csiDirectionKeyFromSuffix(directionMatch[4]! as 'A' | 'B' | 'C' | 'D' | 'H' | 'F');
    const modifierCode = directionMatch[2] ?? directionMatch[3] ?? '1';
    const modifiers = decodeModifiers(parseNumericPrefix(modifierCode) ?? -1);
    if (modifiers === null) {
      return null;
    }
    return {
      key,
      ...modifiers,
    };
  }

  const tildeMatch = payload.match(/^(\d+)(?:;(\d+))?~$/u);
  if (tildeMatch === null) {
    return null;
  }
  const baseCode = parseNumericPrefix(tildeMatch[1]!)!;
  const modifierCode = parseNumericPrefix(tildeMatch[2] ?? '1')!;
  const modifiers = decodeModifiers(modifierCode);
  if (modifiers === null) {
    return null;
  }

  let key: string | null = null;
  if (baseCode === 1 || baseCode === 7) {
    key = 'home';
  } else if (baseCode === 4 || baseCode === 8) {
    key = 'end';
  } else if (baseCode === 3) {
    key = 'delete';
  } else if (baseCode === 2) {
    key = 'insert';
  }
  if (key === null || key === 'insert') {
    return null;
  }
  return {
    key,
    ...modifiers,
  };
}

function decodeInputToStroke(input: Buffer): KeyStroke | null {
  if (input.length === 1) {
    return decodeSingleByte(input[0]!);
  }
  const altPrefixed = parseAltPrefix(input);
  if (altPrefixed !== null) {
    return altPrefixed;
  }
  const text = input.toString('utf8');
  return parseKitty(text) ?? parseModifyOtherKeys(text) ?? parseCsi(text);
}

function normalizeKeyToken(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  return KEY_TOKEN_ALIASES.get(normalized) ?? normalized;
}

function parseBinding(input: string): ParsedBinding | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  const tokens = trimmed
    .split('+')
    .map((part) => normalizeKeyToken(part))
    .flatMap((entry) => (entry === null ? [] : [entry]));
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
  if (key.length !== 1 && !SUPPORTED_NAMED_KEYS.has(key)) {
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

function bindingsForAction(raw: readonly string[]): readonly ParsedBinding[] {
  const parsed: ParsedBinding[] = [];

  const pushIfUnique = (candidate: ParsedBinding): void => {
    if (parsed.some((existing) => strokesEqual(existing.stroke, candidate.stroke))) {
      return;
    }
    parsed.push(candidate);
  };

  for (const value of raw) {
    const next = parseBinding(value);
    if (next !== null) {
      pushIfUnique(next);
    }
  }
  return parsed;
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

export function resolveTaskScreenKeybindings(
  overrides: Readonly<Record<string, readonly string[]>> = {},
): ResolvedTaskScreenKeybindings {
  const rawByAction = {
    ...DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW,
  } as Record<TaskScreenKeybindingAction, readonly string[]>;
  for (const action of ACTION_ORDER) {
    const override = overrides[action];
    if (override !== undefined) {
      rawByAction[action] = override;
    }
  }
  return {
    rawByAction,
    parsedByAction: {
      'mux.home.repo.dropdown.toggle': bindingsForAction(
        rawByAction['mux.home.repo.dropdown.toggle'],
      ),
      'mux.home.repo.next': bindingsForAction(rawByAction['mux.home.repo.next']),
      'mux.home.repo.previous': bindingsForAction(rawByAction['mux.home.repo.previous']),
      'mux.home.task.submit': bindingsForAction(rawByAction['mux.home.task.submit']),
      'mux.home.task.queue': bindingsForAction(rawByAction['mux.home.task.queue']),
      'mux.home.task.newline': bindingsForAction(rawByAction['mux.home.task.newline']),
      'mux.home.task.status.ready': bindingsForAction(rawByAction['mux.home.task.status.ready']),
      'mux.home.task.status.draft': bindingsForAction(rawByAction['mux.home.task.status.draft']),
      'mux.home.task.status.complete': bindingsForAction(
        rawByAction['mux.home.task.status.complete'],
      ),
      'mux.home.task.reorder.up': bindingsForAction(rawByAction['mux.home.task.reorder.up']),
      'mux.home.task.reorder.down': bindingsForAction(rawByAction['mux.home.task.reorder.down']),
      'mux.home.editor.cursor.left': bindingsForAction(rawByAction['mux.home.editor.cursor.left']),
      'mux.home.editor.cursor.right': bindingsForAction(
        rawByAction['mux.home.editor.cursor.right'],
      ),
      'mux.home.editor.cursor.up': bindingsForAction(rawByAction['mux.home.editor.cursor.up']),
      'mux.home.editor.cursor.down': bindingsForAction(rawByAction['mux.home.editor.cursor.down']),
      'mux.home.editor.line.start': bindingsForAction(rawByAction['mux.home.editor.line.start']),
      'mux.home.editor.line.end': bindingsForAction(rawByAction['mux.home.editor.line.end']),
      'mux.home.editor.word.left': bindingsForAction(rawByAction['mux.home.editor.word.left']),
      'mux.home.editor.word.right': bindingsForAction(rawByAction['mux.home.editor.word.right']),
      'mux.home.editor.delete.backward': bindingsForAction(
        rawByAction['mux.home.editor.delete.backward'],
      ),
      'mux.home.editor.delete.forward': bindingsForAction(
        rawByAction['mux.home.editor.delete.forward'],
      ),
      'mux.home.editor.delete.word.backward': bindingsForAction(
        rawByAction['mux.home.editor.delete.word.backward'],
      ),
      'mux.home.editor.delete.line.start': bindingsForAction(
        rawByAction['mux.home.editor.delete.line.start'],
      ),
      'mux.home.editor.delete.line.end': bindingsForAction(
        rawByAction['mux.home.editor.delete.line.end'],
      ),
    },
  };
}

export function firstTaskScreenShortcutText(
  bindings: ResolvedTaskScreenKeybindings,
  action: TaskScreenKeybindingAction,
): string {
  return bindings.rawByAction[action][0] ?? '';
}

export function detectTaskScreenKeybindingAction(
  input: Buffer,
  bindings: ResolvedTaskScreenKeybindings,
): TaskScreenKeybindingAction | null {
  const stroke = decodeInputToStroke(input);
  if (stroke === null) {
    return null;
  }
  for (const action of ACTION_ORDER) {
    if (bindings.parsedByAction[action].some((binding) => strokesEqual(binding.stroke, stroke))) {
      return action;
    }
  }
  return null;
}
