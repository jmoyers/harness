export interface TaskEditorPromptInputState {
  title: string;
  description: string;
  repositoryIds: readonly string[];
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
}

interface TaskEditorPromptReduction {
  title: string;
  description: string;
  repositoryIndex: number;
  fieldIndex: 0 | 1 | 2;
  submit: boolean;
}

interface LinePromptReduction {
  value: string;
  submit: boolean;
}

export function reduceLinePromptInput(value: string, input: Buffer): LinePromptReduction {
  let nextValue = value;
  let submit = false;
  for (const byte of input) {
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
  let nextDescription = prompt.description;
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
          nextDescription = nextDescription.slice(0, -1);
        }
        continue;
      }
      if (byte >= 32 && byte <= 126) {
        if (nextFieldIndex === 0) {
          nextTitle += String.fromCharCode(byte);
        } else if (nextFieldIndex === 2) {
          nextDescription += String.fromCharCode(byte);
        }
      }
    }
  }
  return {
    title: nextTitle,
    description: nextDescription,
    repositoryIndex: nextRepositoryIndex,
    fieldIndex: nextFieldIndex,
    submit,
  };
}
