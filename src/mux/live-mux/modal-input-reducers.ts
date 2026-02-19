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

const BRACKETED_PASTE_START = Buffer.from('\u001b[200~', 'utf8');
const BRACKETED_PASTE_END = Buffer.from('\u001b[201~', 'utf8');

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

export function reduceLinePromptInput(value: string, input: Buffer): LinePromptReduction {
  let nextValue = value;
  let submit = false;
  let inBracketedPaste = false;
  for (let index = 0; index < input.length; index += 1) {
    if (!inBracketedPaste && matchesSequence(input, index, BRACKETED_PASTE_START)) {
      inBracketedPaste = true;
      index += BRACKETED_PASTE_START.length - 1;
      continue;
    }
    if (inBracketedPaste && matchesSequence(input, index, BRACKETED_PASTE_END)) {
      inBracketedPaste = false;
      index += BRACKETED_PASTE_END.length - 1;
      continue;
    }
    const byte = input[index]!;
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
  return {
    value: nextValue,
    submit,
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
