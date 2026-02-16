type ThreadAgentType = 'codex' | 'terminal';

const EMPTY_NEW_THREAD_PROMPT_INPUT = new Uint8Array();

interface NewThreadPromptState {
  readonly directoryId: string;
  readonly selectedAgentType: ThreadAgentType;
}

interface NewThreadPromptInputResult {
  readonly nextState: NewThreadPromptState;
  readonly submit: boolean;
}

export function createNewThreadPromptState(directoryId: string): NewThreadPromptState {
  return {
    directoryId,
    selectedAgentType: 'codex'
  };
}

export function normalizeThreadAgentType(value: string): ThreadAgentType {
  return value === 'terminal' ? 'terminal' : 'codex';
}

export function nextThreadAgentType(value: ThreadAgentType): ThreadAgentType {
  return value === 'codex' ? 'terminal' : 'codex';
}

function parseEncodedPromptKeyCode(input: Uint8Array): number | null {
  if (!input.includes(0x1b)) {
    return null;
  }
  const text = Buffer.from(input).toString('utf8');
  if (text.startsWith('\u001b[') && text.endsWith('u')) {
    const kittyPayload = text.slice(2, -1);
    const kittyMatch = kittyPayload.match(/^(\d+)(?::\d+)?(?:;\d+(?::\d+)?)?$/u);
    if (kittyMatch !== null) {
      return Number.parseInt(kittyMatch[1]!, 10);
    }
  }
  if (text.startsWith('\u001b[') && text.endsWith('~')) {
    const modifyPayload = text.slice(2, -1);
    const modifyOtherKeysMatch = modifyPayload.match(/^27;\d+;(\d+)$/u);
    if (modifyOtherKeysMatch !== null) {
      return Number.parseInt(modifyOtherKeysMatch[1]!, 10);
    }
  }
  return null;
}

function normalizePromptInputBytes(input: Uint8Array): Uint8Array {
  const keyCode = parseEncodedPromptKeyCode(input);
  if (keyCode === null) {
    return input.includes(0x1b) ? EMPTY_NEW_THREAD_PROMPT_INPUT : input;
  }
  if (keyCode < 0 || keyCode > 0xff) {
    return EMPTY_NEW_THREAD_PROMPT_INPUT;
  }
  return Uint8Array.from([keyCode]);
}

export function reduceNewThreadPromptInput(
  state: NewThreadPromptState,
  input: Uint8Array
): NewThreadPromptInputResult {
  const normalizedInput = normalizePromptInputBytes(input);
  let selectedAgentType = state.selectedAgentType;
  let submit = false;
  for (const byte of normalizedInput) {
    if (byte === 0x0d || byte === 0x0a) {
      submit = true;
      break;
    } else if (byte === 0x09 || byte === 0x20) {
      selectedAgentType = nextThreadAgentType(selectedAgentType);
    } else if (byte === 0x31 || byte === 0x63 || byte === 0x43) {
      selectedAgentType = 'codex';
    } else if (byte === 0x32 || byte === 0x74 || byte === 0x54) {
      selectedAgentType = 'terminal';
    }
  }
  return {
    nextState: {
      directoryId: state.directoryId,
      selectedAgentType
    },
    submit
  };
}

export function resolveNewThreadPromptAgentByRow(
  overlayTopRowZeroBased: number,
  rowOneBased: number
): ThreadAgentType | null {
  const codexRow = overlayTopRowZeroBased + 4;
  const terminalRow = overlayTopRowZeroBased + 5;
  if (rowOneBased - 1 === codexRow) {
    return 'codex';
  }
  if (rowOneBased - 1 === terminalRow) {
    return 'terminal';
  }
  return null;
}

export function newThreadPromptBodyLines(
  state: NewThreadPromptState,
  labels: {
    readonly codexButtonLabel: string;
    readonly terminalButtonLabel: string;
  }
): readonly string[] {
  const codexSelected = state.selectedAgentType === 'codex';
  const terminalSelected = state.selectedAgentType === 'terminal';
  return [
    'choose thread type',
    '',
    `${codexSelected ? '●' : '○'} ${labels.codexButtonLabel}`,
    `${terminalSelected ? '●' : '○'} ${labels.terminalButtonLabel}`,
    '',
    'c/t toggle'
  ];
}
