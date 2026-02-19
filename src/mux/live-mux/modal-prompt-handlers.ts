import { reduceLinePromptInput } from './modal-input-reducers.ts';

interface AddDirectoryPromptState {
  value: string;
  error: string | null;
}

interface RepositoryPromptState {
  readonly mode: 'add' | 'edit';
  readonly repositoryId: string | null;
  readonly value: string;
  readonly error: string | null;
}

interface ApiKeyPromptState {
  readonly keyName: string;
  readonly displayName: string;
  readonly value: string;
  readonly error: string | null;
  readonly hasExistingValue: boolean;
}

interface HandleAddDirectoryPromptInputOptions {
  input: Buffer;
  prompt: AddDirectoryPromptState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  setPrompt: (next: AddDirectoryPromptState | null) => void;
  markDirty: () => void;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  addDirectoryByPath: (path: string) => Promise<void>;
}

interface HandleRepositoryPromptInputOptions {
  input: Buffer;
  prompt: RepositoryPromptState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  setPrompt: (next: RepositoryPromptState | null) => void;
  markDirty: () => void;
  repositoriesHas: (repositoryId: string) => boolean;
  normalizeGitHubRemoteUrl: (remoteUrl: string) => string | null;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  upsertRepositoryByRemoteUrl: (remoteUrl: string, existingRepositoryId?: string) => Promise<void>;
}

interface HandleApiKeyPromptInputOptions {
  input: Buffer;
  prompt: ApiKeyPromptState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (input: Buffer, dismiss: () => void) => boolean;
  setPrompt: (next: ApiKeyPromptState | null) => void;
  markDirty: () => void;
  persistApiKey: (keyName: string, value: string) => void;
}

export function handleAddDirectoryPromptInput(
  options: HandleAddDirectoryPromptInputOptions,
): boolean {
  const {
    input,
    prompt,
    isQuitShortcut,
    dismissOnOutsideClick,
    setPrompt,
    markDirty,
    queueControlPlaneOp,
    addDirectoryByPath,
  } = options;
  if (prompt === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    setPrompt(null);
    markDirty();
    return true;
  }
  if (
    dismissOnOutsideClick(input, () => {
      setPrompt(null);
      markDirty();
    })
  ) {
    return true;
  }

  const reduced = reduceLinePromptInput(prompt.value, input);
  const value = reduced.value;
  const submit = reduced.submit;

  if (!submit) {
    setPrompt({
      value,
      error: null,
    });
    markDirty();
    return true;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    setPrompt({
      value,
      error: 'path required',
    });
    markDirty();
    return true;
  }
  setPrompt(null);
  queueControlPlaneOp(async () => {
    await addDirectoryByPath(trimmed);
  }, 'prompt-add-directory');
  markDirty();
  return true;
}

export function handleRepositoryPromptInput(options: HandleRepositoryPromptInputOptions): boolean {
  const {
    input,
    prompt,
    isQuitShortcut,
    dismissOnOutsideClick,
    setPrompt,
    markDirty,
    repositoriesHas,
    normalizeGitHubRemoteUrl,
    queueControlPlaneOp,
    upsertRepositoryByRemoteUrl,
  } = options;
  if (prompt === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    setPrompt(null);
    markDirty();
    return true;
  }
  if (
    dismissOnOutsideClick(input, () => {
      setPrompt(null);
      markDirty();
    })
  ) {
    return true;
  }

  const reduced = reduceLinePromptInput(prompt.value, input);
  const value = reduced.value;
  const submit = reduced.submit;

  if (!submit) {
    setPrompt({
      ...prompt,
      value,
      error: null,
    });
    markDirty();
    return true;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    setPrompt({
      ...prompt,
      value,
      error: 'github url required',
    });
    markDirty();
    return true;
  }
  if (normalizeGitHubRemoteUrl(trimmed) === null) {
    setPrompt({
      ...prompt,
      value,
      error: 'github url required',
    });
    markDirty();
    return true;
  }

  const mode = prompt.mode;
  const repositoryId = prompt.repositoryId;
  setPrompt(null);
  if (mode === 'edit' && (repositoryId === null || !repositoriesHas(repositoryId))) {
    markDirty();
    return true;
  }
  queueControlPlaneOp(
    async () => {
      await upsertRepositoryByRemoteUrl(
        trimmed,
        mode === 'edit' ? (repositoryId ?? undefined) : undefined,
      );
    },
    mode === 'edit' ? 'prompt-edit-repository' : 'prompt-add-repository',
  );
  markDirty();
  return true;
}

export function handleApiKeyPromptInput(options: HandleApiKeyPromptInputOptions): boolean {
  const {
    input,
    prompt,
    isQuitShortcut,
    dismissOnOutsideClick,
    setPrompt,
    markDirty,
    persistApiKey,
  } = options;
  if (prompt === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    setPrompt(null);
    markDirty();
    return true;
  }
  if (
    dismissOnOutsideClick(input, () => {
      setPrompt(null);
      markDirty();
    })
  ) {
    return true;
  }

  const reduced = reduceLinePromptInput(prompt.value, input);
  const value = reduced.value;
  if (!reduced.submit) {
    setPrompt({
      ...prompt,
      value,
      error: null,
    });
    markDirty();
    return true;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    setPrompt({
      ...prompt,
      value,
      error: `${prompt.displayName.toLowerCase()} required`,
    });
    markDirty();
    return true;
  }
  try {
    persistApiKey(prompt.keyName, trimmed);
    setPrompt(null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setPrompt({
      ...prompt,
      value,
      error: message,
    });
  }
  markDirty();
  return true;
}
