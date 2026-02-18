type ThreadAgentType = 'codex' | 'claude' | 'cursor' | 'terminal' | 'critique';

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
  if (value === 'terminal' || value === 'claude' || value === 'cursor' || value === 'critique') {
    return value;
  }
  return 'codex';
}

export function nextThreadAgentType(value: ThreadAgentType): ThreadAgentType {
  if (value === 'codex') {
    return 'claude';
  }
  if (value === 'claude') {
    return 'cursor';
  }
  if (value === 'cursor') {
    return 'terminal';
  }
  if (value === 'terminal') {
    return 'critique';
  }
  return 'codex';
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
    } else if (byte === 0x32 || byte === 0x61 || byte === 0x41) {
      selectedAgentType = 'claude';
    } else if (byte === 0x33 || byte === 0x75 || byte === 0x55) {
      selectedAgentType = 'cursor';
    } else if (byte === 0x34 || byte === 0x74 || byte === 0x54) {
      selectedAgentType = 'terminal';
    } else if (byte === 0x35 || byte === 0x72 || byte === 0x52) {
      selectedAgentType = 'critique';
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
  const claudeRow = overlayTopRowZeroBased + 5;
  const cursorRow = overlayTopRowZeroBased + 6;
  const terminalRow = overlayTopRowZeroBased + 7;
  const critiqueRow = overlayTopRowZeroBased + 8;
  if (rowOneBased - 1 === codexRow) {
    return 'codex';
  }
  if (rowOneBased - 1 === claudeRow) {
    return 'claude';
  }
  if (rowOneBased - 1 === cursorRow) {
    return 'cursor';
  }
  if (rowOneBased - 1 === terminalRow) {
    return 'terminal';
  }
  if (rowOneBased - 1 === critiqueRow) {
    return 'critique';
  }
  return null;
}

export function newThreadPromptBodyLines(
  state: NewThreadPromptState,
  labels: {
    readonly codexButtonLabel: string;
    readonly claudeButtonLabel: string;
    readonly cursorButtonLabel: string;
    readonly terminalButtonLabel: string;
    readonly critiqueButtonLabel: string;
  }
): readonly string[] {
  const codexSelected = state.selectedAgentType === 'codex';
  const claudeSelected = state.selectedAgentType === 'claude';
  const cursorSelected = state.selectedAgentType === 'cursor';
  const terminalSelected = state.selectedAgentType === 'terminal';
  const critiqueSelected = state.selectedAgentType === 'critique';
  return [
    'choose thread type',
    '',
    `${codexSelected ? '●' : '○'} ${labels.codexButtonLabel}`,
    `${claudeSelected ? '●' : '○'} ${labels.claudeButtonLabel}`,
    `${cursorSelected ? '●' : '○'} ${labels.cursorButtonLabel}`,
    `${terminalSelected ? '●' : '○'} ${labels.terminalButtonLabel}`,
    `${critiqueSelected ? '●' : '○'} ${labels.critiqueButtonLabel}`,
    '',
    'c/a/u/t/r toggle'
  ];
}
