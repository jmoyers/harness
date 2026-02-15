type ThreadAgentType = 'codex' | 'terminal';

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

export function reduceNewThreadPromptInput(
  state: NewThreadPromptState,
  input: Uint8Array
): NewThreadPromptInputResult {
  let selectedAgentType = state.selectedAgentType;
  let submit = false;
  for (const byte of input) {
    if (byte === 0x0d || byte === 0x0a) {
      submit = true;
      break;
    }
    if (byte === 0x09 || byte === 0x20) {
      selectedAgentType = nextThreadAgentType(selectedAgentType);
      continue;
    }
    if (byte === 0x31 || byte === 0x63 || byte === 0x43) {
      selectedAgentType = 'codex';
      continue;
    }
    if (byte === 0x32 || byte === 0x74 || byte === 0x54) {
      selectedAgentType = 'terminal';
      continue;
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
