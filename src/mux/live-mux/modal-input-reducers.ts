export interface TaskEditorPromptInputState {
  title: string;
  body: string;
  repositoryIds: readonly string[];
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
}

interface TaskEditorPromptReduction {
  title: string;
  body: string;
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
  submit: boolean;
}

interface LinePromptReduction {
  value: string;
  submit: boolean;
}

export interface LinePromptInputState {
  readonly inBracketedPaste: boolean;
  readonly pendingSequence: Buffer;
}

interface StatefulLinePromptReduction extends LinePromptReduction {
  readonly lineInputState: LinePromptInputState;
}

const BRACKETED_PASTE_START = Buffer.from('\u001b[200~', 'utf8');
const BRACKETED_PASTE_END = Buffer.from('\u001b[201~', 'utf8');
const EMPTY_BUFFER = Buffer.alloc(0);

export function createLinePromptInputState(): LinePromptInputState {
  return {
    inBracketedPaste: false,
    pendingSequence: EMPTY_BUFFER,
  };
}

function matchesSequence(input: Buffer, startIndex: number, sequence: Buffer): boolean {
  if (startIndex < 0 || startIndex + sequence.length > input.length) {
    return false;
  }
  for (let index = 0; index < sequence.length; index += 1) {
    if (input[startIndex + index] !== sequence[index]) {
      return false;
    }
  }
  return true;
}

function isTruncatedSequencePrefix(input: Buffer, startIndex: number, sequence: Buffer): boolean {
  const remaining = input.length - startIndex;
  if (remaining >= sequence.length) {
    return false;
  }
  for (let index = 0; index < remaining; index += 1) {
    if (input[startIndex + index] !== sequence[index]) {
      return false;
    }
  }
  return true;
}

export function reduceLinePromptInput(value: string, input: Buffer): LinePromptReduction;
export function reduceLinePromptInput(
  value: string,
  input: Buffer,
  lineInputState: LinePromptInputState,
): StatefulLinePromptReduction;
export function reduceLinePromptInput(
  value: string,
  input: Buffer,
  lineInputState?: LinePromptInputState,
): LinePromptReduction | StatefulLinePromptReduction {
  const activeState = lineInputState ?? createLinePromptInputState();
  const mergedInput =
    activeState.pendingSequence.length === 0
      ? input
      : Buffer.concat([activeState.pendingSequence, input]);

  let nextValue = value;
  let submit = false;
  let inBracketedPaste = activeState.inBracketedPaste;
  let pendingSequence = EMPTY_BUFFER;
  for (let index = 0; index < mergedInput.length; index += 1) {
    if (!inBracketedPaste && matchesSequence(mergedInput, index, BRACKETED_PASTE_START)) {
      inBracketedPaste = true;
      index += BRACKETED_PASTE_START.length - 1;
      continue;
    }
    if (matchesSequence(mergedInput, index, BRACKETED_PASTE_END)) {
      inBracketedPaste = false;
      index += BRACKETED_PASTE_END.length - 1;
      continue;
    }
    if (
      isTruncatedSequencePrefix(mergedInput, index, BRACKETED_PASTE_START) ||
      isTruncatedSequencePrefix(mergedInput, index, BRACKETED_PASTE_END)
    ) {
      pendingSequence = Buffer.from(mergedInput.subarray(index));
      break;
    }

    const byte = mergedInput[index]!;
    if (inBracketedPaste) {
      if (byte >= 32 && byte <= 126) {
        nextValue += String.fromCharCode(byte);
      }
      continue;
    }
    if (byte === 0x0d || byte === 0x0a) {
      submit = true;
      break;
    }
    if (byte === 0x7f || byte === 0x08) {
      nextValue = nextValue.slice(0, -1);
      continue;
    }
    if (byte >= 32 && byte <= 126) {
      nextValue += String.fromCharCode(byte);
    }
  }
  if (lineInputState === undefined) {
    return {
      value: nextValue,
      submit,
    };
  }
  return {
    value: nextValue,
    submit,
    lineInputState: {
      inBracketedPaste,
      pendingSequence,
    },
  };
}

export function reduceTaskEditorPromptInput(
  prompt: TaskEditorPromptInputState,
  input: Buffer,
): TaskEditorPromptReduction {
  let nextTitle = prompt.title;
  let nextBody = prompt.body;
  let nextFieldIndex = prompt.fieldIndex;
  let nextRepositoryIndex = prompt.repositoryIndex;
  let submit = false;
  const text = input.toString('utf8');
  if (text === '\u001b[C') {
    nextFieldIndex = 1;
    nextRepositoryIndex = Math.min(prompt.repositoryIds.length - 1, prompt.repositoryIndex + 1);
  } else if (text === '\u001b[D') {
    nextFieldIndex = 1;
    nextRepositoryIndex = Math.max(0, prompt.repositoryIndex - 1);
  } else {
    for (const byte of input) {
      if (byte === 0x0d || byte === 0x0a) {
        submit = true;
        break;
      }
      if (byte === 0x09) {
        nextFieldIndex = ((nextFieldIndex + 1) % 3) as 0 | 1 | 2;
        continue;
      }
      if (byte === 0x7f || byte === 0x08) {
        if (nextFieldIndex === 0) {
          nextTitle = nextTitle.slice(0, -1);
        } else if (nextFieldIndex === 2) {
          nextBody = nextBody.slice(0, -1);
        }
        continue;
      }
      if (byte >= 32 && byte <= 126) {
        if (nextFieldIndex === 0) {
          nextTitle += String.fromCharCode(byte);
        } else if (nextFieldIndex === 2) {
          nextBody += String.fromCharCode(byte);
        }
      }
    }
  }
  return {
    title: nextTitle,
    body: nextBody,
    repositoryIndex: nextRepositoryIndex,
    fieldIndex: nextFieldIndex,
    submit,
  };
}
