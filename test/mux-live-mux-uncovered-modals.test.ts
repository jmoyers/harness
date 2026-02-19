import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { createNewThreadPromptState } from '../src/mux/new-thread-prompt.ts';
import {
  reduceLinePromptInput,
  reduceTaskEditorPromptInput,
} from '../src/mux/live-mux/modal-input-reducers.ts';
import {
  handleApiKeyPromptInput,
  handleAddDirectoryPromptInput,
  handleRepositoryPromptInput,
} from '../src/mux/live-mux/modal-prompt-handlers.ts';
import { handleTaskEditorPromptInput } from '../src/mux/live-mux/modal-task-editor-handler.ts';
import {
  handleConversationTitleEditInput,
  handleNewThreadPromptInput,
} from '../src/mux/live-mux/modal-conversation-handlers.ts';
import {
  buildCommandMenuModalOverlay,
  buildAddDirectoryModalOverlay,
  buildApiKeyModalOverlay,
  buildConversationTitleModalOverlay,
  buildNewThreadModalOverlay,
  buildRepositoryModalOverlay,
  buildTaskEditorModalOverlay,
} from '../src/mux/live-mux/modal-overlays.ts';

void test('modal input reducers normalize line and task-editor input branches', () => {
  assert.deepEqual(reduceLinePromptInput('abc', Buffer.from('\u0008d', 'utf8')), {
    value: 'abd',
    submit: false,
  });
  assert.deepEqual(reduceLinePromptInput('abc', Buffer.from('\rrest', 'utf8')), {
    value: 'abc',
    submit: true,
  });
  assert.deepEqual(
    reduceLinePromptInput('token=', Buffer.from('\u001b[200~abc123\u001b[201~', 'utf8')),
    {
      value: 'token=abc123',
      submit: false,
    },
  );

  const basePrompt = {
    title: 'Title',
    description: 'Desc',
    repositoryIds: ['repo-a', 'repo-b'],
    repositoryIndex: 0,
    fieldIndex: 0 as 0 | 1 | 2,
  };
  assert.deepEqual(reduceTaskEditorPromptInput(basePrompt, Buffer.from('\u001b[C', 'utf8')), {
    title: 'Title',
    description: 'Desc',
    repositoryIndex: 1,
    fieldIndex: 1,
    submit: false,
  });
  assert.deepEqual(
    reduceTaskEditorPromptInput(
      {
        ...basePrompt,
        repositoryIndex: 1,
        fieldIndex: 1,
      },
      Buffer.from('\u001b[D', 'utf8'),
    ),
    {
      title: 'Title',
      description: 'Desc',
      repositoryIndex: 0,
      fieldIndex: 1,
      submit: false,
    },
  );
  assert.deepEqual(
    reduceTaskEditorPromptInput(
      {
        ...basePrompt,
        fieldIndex: 0,
      },
      Buffer.from('\tA', 'utf8'),
    ),
    {
      title: 'Title',
      description: 'Desc',
      repositoryIndex: 0,
      fieldIndex: 1,
      submit: false,
    },
  );
  assert.deepEqual(
    reduceTaskEditorPromptInput(
      {
        ...basePrompt,
        fieldIndex: 2,
      },
      Buffer.from('\u007f!', 'utf8'),
    ),
    {
      title: 'Title',
      description: 'Des!',
      repositoryIndex: 0,
      fieldIndex: 2,
      submit: false,
    },
  );
  assert.deepEqual(
    reduceTaskEditorPromptInput(
      {
        ...basePrompt,
        fieldIndex: 0,
      },
      Buffer.from('\u007f', 'utf8'),
    ),
    {
      title: 'Titl',
      description: 'Desc',
      repositoryIndex: 0,
      fieldIndex: 0,
      submit: false,
    },
  );
  assert.deepEqual(reduceTaskEditorPromptInput(basePrompt, Buffer.from('\n', 'utf8')), {
    title: 'Title',
    description: 'Desc',
    repositoryIndex: 0,
    fieldIndex: 0,
    submit: true,
  });
});

void test('add-directory and repository prompt handlers cover quit dismiss edit and submit paths', async () => {
  const calls: string[] = [];
  const queued: Array<() => Promise<void>> = [];
  const commonAdd = {
    isQuitShortcut: (input: Buffer) => input.toString('utf8') === 'q',
    dismissOnOutsideClick: () => false,
    setPrompt: (next: { value: string; error: string | null } | null) => {
      calls.push(`setAddPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    queueControlPlaneOp: (task: () => Promise<void>, label: string) => {
      calls.push(`queue:${label}`);
      queued.push(task);
    },
    addDirectoryByPath: async (path: string) => {
      calls.push(`addDirectoryByPath:${path}`);
    },
  };

  assert.equal(
    handleAddDirectoryPromptInput({ input: Buffer.from('x', 'utf8'), prompt: null, ...commonAdd }),
    false,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from([0x03]),
      prompt: { value: '', error: null },
      ...commonAdd,
    }),
    false,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from('q', 'utf8'),
      prompt: { value: '', error: null },
      ...commonAdd,
    }),
    true,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt: { value: '', error: null },
      ...commonAdd,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
    }),
    true,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from('abc', 'utf8'),
      prompt: { value: '', error: null },
      ...commonAdd,
    }),
    true,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: { value: '   ', error: null },
      ...commonAdd,
    }),
    true,
  );
  assert.equal(
    handleAddDirectoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: { value: ' ./repo ', error: null },
      ...commonAdd,
    }),
    true,
  );
  while (queued.length > 0) {
    await queued.shift()?.();
  }
  assert.equal(calls.includes('queue:prompt-add-directory'), true);
  assert.equal(calls.includes('addDirectoryByPath:./repo'), true);

  calls.length = 0;
  const queuedRepo: Array<() => Promise<void>> = [];
  const commonRepo = {
    isQuitShortcut: (input: Buffer) => input.toString('utf8') === 'q',
    dismissOnOutsideClick: () => false,
    setPrompt: (
      next: {
        mode: 'add' | 'edit';
        repositoryId: string | null;
        value: string;
        error: string | null;
      } | null,
    ) => {
      calls.push(`setRepoPrompt:${next?.mode ?? 'null'}:${next?.error ?? 'null'}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    repositoriesHas: (repositoryId: string) => repositoryId === 'repo-a',
    normalizeGitHubRemoteUrl: (remoteUrl: string) =>
      remoteUrl.includes('github.com') ? remoteUrl.trim() : null,
    queueControlPlaneOp: (task: () => Promise<void>, label: string) => {
      calls.push(`queue:${label}`);
      queuedRepo.push(task);
    },
    upsertRepositoryByRemoteUrl: async (remoteUrl: string, repositoryId?: string) => {
      calls.push(`upsertRepositoryByRemoteUrl:${remoteUrl}:${repositoryId ?? 'none'}`);
    },
  };

  assert.equal(
    handleRepositoryPromptInput({ input: Buffer.from('x', 'utf8'), prompt: null, ...commonRepo }),
    false,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from([0x03]),
      prompt: { mode: 'add', repositoryId: null, value: '', error: null },
      ...commonRepo,
    }),
    false,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('q', 'utf8'),
      prompt: { mode: 'add', repositoryId: null, value: '', error: null },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt: { mode: 'add', repositoryId: null, value: '', error: null },
      ...commonRepo,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('abc', 'utf8'),
      prompt: { mode: 'add', repositoryId: null, value: '', error: null },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: { mode: 'add', repositoryId: null, value: '   ', error: null },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: { mode: 'add', repositoryId: null, value: 'not-a-github-url', error: null },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: {
        mode: 'edit',
        repositoryId: null,
        value: 'https://github.com/org/repo',
        error: null,
      },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: {
        mode: 'edit',
        repositoryId: 'repo-a',
        value: 'https://github.com/org/repo',
        error: null,
      },
      ...commonRepo,
    }),
    true,
  );
  assert.equal(
    handleRepositoryPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: {
        mode: 'add',
        repositoryId: null,
        value: 'https://github.com/org/repo',
        error: null,
      },
      ...commonRepo,
    }),
    true,
  );
  while (queuedRepo.length > 0) {
    await queuedRepo.shift()?.();
  }
  assert.equal(calls.includes('queue:prompt-edit-repository'), true);
  assert.equal(calls.includes('queue:prompt-add-repository'), true);

  calls.length = 0;
  const persistedKeys: string[] = [];
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt: null,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: () => {},
      markDirty: () => {},
      persistApiKey: () => {},
    }),
    false,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from([0x03]),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: 'ignored',
        error: null,
        hasExistingValue: false,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: () => {
        calls.push('persistApiKey');
      },
    }),
    false,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('q', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: 'ignored',
        error: null,
        hasExistingValue: false,
      },
      isQuitShortcut: () => true,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: () => {
        calls.push('persistApiKey');
      },
    }),
    true,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: 'ignored',
        error: null,
        hasExistingValue: false,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: () => {
        calls.push('persistApiKey');
      },
    }),
    true,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('updated', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: '',
        error: 'old-error',
        hasExistingValue: false,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: () => {
        calls.push('persistApiKey');
      },
    }),
    true,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: '   ',
        error: null,
        hasExistingValue: false,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: (keyName, value) => {
        persistedKeys.push(`${keyName}:${value}`);
      },
    }),
    true,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('\u001b[200~new-key\u001b[201~\n', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: '',
        error: null,
        hasExistingValue: true,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: (keyName, value) => {
        persistedKeys.push(`${keyName}:${value}`);
      },
    }),
    true,
  );
  assert.equal(
    handleApiKeyPromptInput({
      input: Buffer.from('broken\n', 'utf8'),
      prompt: {
        keyName: 'OPENAI_API_KEY',
        displayName: 'OpenAI API Key',
        value: '',
        error: null,
        hasExistingValue: false,
      },
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      setPrompt: (next) => {
        calls.push(`setApiPrompt:${next?.value ?? 'null'}:${next?.error ?? 'null'}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      persistApiKey: () => {
        throw new Error('persist failed');
      },
    }),
    true,
  );
  assert.equal(persistedKeys.includes('OPENAI_API_KEY:new-key'), true);
  assert.equal(calls.includes('setApiPrompt:null:null'), true);
  assert.equal(calls.includes('setApiPrompt:broken:persist failed'), true);
});

void test('task editor handler covers dismiss change and submit validation branches', () => {
  const prompt = {
    mode: 'create' as const,
    taskId: null,
    title: 'Task',
    description: 'Desc',
    repositoryIds: ['repo-a'],
    repositoryIndex: 0,
    fieldIndex: 0 as 0 | 1 | 2,
    error: null,
  };
  assert.deepEqual(
    handleTaskEditorPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt: null,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
    }),
    { handled: false, markDirty: false },
  );
  assert.deepEqual(
    handleTaskEditorPromptInput({
      input: Buffer.from([0x03]),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
    }),
    { handled: false, markDirty: false },
  );
  assert.deepEqual(
    handleTaskEditorPromptInput({
      input: Buffer.from('q', 'utf8'),
      prompt,
      isQuitShortcut: () => true,
      dismissOnOutsideClick: () => false,
    }),
    { handled: true, nextPrompt: null, markDirty: true },
  );
  assert.deepEqual(
    handleTaskEditorPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => true,
    }),
    { handled: true, markDirty: false },
  );
  assert.deepEqual(
    handleTaskEditorPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
    }),
    { handled: true, nextPrompt: null, markDirty: true },
  );

  const changed = handleTaskEditorPromptInput({
    input: Buffer.from('!', 'utf8'),
    prompt,
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.equal(changed.handled, true);
  assert.equal(changed.markDirty, true);
  assert.equal(changed.nextPrompt?.title.endsWith('!'), true);

  const noChange = handleTaskEditorPromptInput({
    input: Buffer.from('', 'utf8'),
    prompt,
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.deepEqual(noChange, { handled: true, markDirty: false });

  const noTitle = handleTaskEditorPromptInput({
    input: Buffer.from('\n', 'utf8'),
    prompt: { ...prompt, title: '   ' },
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.equal(noTitle.nextPrompt?.error, 'title required');

  const noRepo = handleTaskEditorPromptInput({
    input: Buffer.from('\n', 'utf8'),
    prompt: { ...prompt, repositoryIds: [], repositoryIndex: 0 },
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.equal(noRepo.nextPrompt?.error, 'repository required');

  const submit = handleTaskEditorPromptInput({
    input: Buffer.from('\n', 'utf8'),
    prompt,
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.deepEqual(submit.submitPayload, {
    mode: 'create',
    taskId: null,
    repositoryId: 'repo-a',
    title: 'Task',
    description: 'Desc',
    commandLabel: 'tasks-create',
  });

  const submitChanged = handleTaskEditorPromptInput({
    input: Buffer.from('!\n', 'utf8'),
    prompt,
    isQuitShortcut: () => false,
    dismissOnOutsideClick: () => false,
  });
  assert.equal(submitChanged.nextPrompt?.title, 'Task!');
  assert.equal(submitChanged.markDirty, true);
});

void test('conversation modal handlers cover archive click/prompt and new-thread keyboard+pointer flows', async () => {
  const calls: string[] = [];
  const queued: Array<() => Promise<void>> = [];
  const conversations = new Map([
    [
      'session-a',
      {
        title: 'Original',
      },
    ],
  ]);
  const edit = {
    conversationId: 'session-a',
    value: 'Original',
    lastSavedValue: 'Original',
    error: null as string | null,
    persistInFlight: false,
    debounceTimer: null,
  };
  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('x', 'utf8'),
      edit: null,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      archiveConversation: async () => {
        calls.push('archiveConversation');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    false,
  );
  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from([0x03]),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      archiveConversation: async () => {
        calls.push('archiveConversation');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    false,
  );
  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('q', 'utf8'),
      edit,
      isQuitShortcut: () => true,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      archiveConversation: async () => {
        calls.push('archiveConversation');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(calls.includes('stopConversationTitleEdit'), true);
  calls.length = 0;

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      archiveConversation: async () => {
        calls.push('archiveConversation');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(calls.includes('stopConversationTitleEdit'), true);
  calls.length = 0;

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        onInsidePointerPress?.(10, 10);
        return true;
      },
      buildConversationTitleModalOverlay: () => null,
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        queued.push(task);
      },
      archiveConversation: async (sessionId: string) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(calls.length, 0);

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        onInsidePointerPress?.(10, 3);
        return true;
      },
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        queued.push(task);
      },
      archiveConversation: async (sessionId: string) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(calls.length, 0);

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('a', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => true,
      dismissOnOutsideClick: () => false,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        queued.push(task);
      },
      archiveConversation: async (sessionId: string) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(calls.includes('queue:modal-archive-conversation'), true);
  while (queued.length > 0) {
    await queued.shift()?.();
  }
  assert.equal(calls.includes('archiveConversation:session-a'), true);
  calls.length = 0;

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('x', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) =>
        onInsidePointerPress?.(0, 7) === true,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        queued.push(task);
      },
      archiveConversation: async (sessionId: string) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  while (queued.length > 0) {
    await queued.shift()?.();
  }
  assert.equal(calls.includes('queue:modal-archive-conversation-click'), true);
  calls.length = 0;

  assert.equal(
    handleConversationTitleEditInput({
      input: Buffer.from('X\n', 'utf8'),
      edit,
      isQuitShortcut: () => false,
      isArchiveShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildConversationTitleModalOverlay: () => ({ top: 1 }),
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      archiveConversation: async () => {
        calls.push('archiveConversation');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      conversations,
      scheduleConversationTitlePersist: () => {
        calls.push('scheduleConversationTitlePersist');
      },
    }),
    true,
  );
  assert.equal(edit.value.endsWith('X'), true);
  assert.equal(conversations.get('session-a')?.title.endsWith('X'), true);
  assert.equal(calls.includes('scheduleConversationTitlePersist'), true);
  assert.equal(calls.includes('stopConversationTitleEdit'), true);

  calls.length = 0;
  const threadQueued: Array<() => Promise<void>> = [];
  const prompt = createNewThreadPromptState('dir-a');
  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('x', 'utf8'),
      prompt: null,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      createAndActivateConversationInDirectory: async () => {
        calls.push('createAndActivateConversationInDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: () => {
        calls.push('setPrompt');
      },
    }),
    false,
  );
  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from([0x03]),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      createAndActivateConversationInDirectory: async () => {
        calls.push('createAndActivateConversationInDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: () => {
        calls.push('setPrompt');
      },
    }),
    false,
  );
  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('q', 'utf8'),
      prompt,
      isQuitShortcut: () => true,
      dismissOnOutsideClick: () => false,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      createAndActivateConversationInDirectory: async () => {
        calls.push('createAndActivateConversationInDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  assert.equal(calls.includes('setPrompt:null'), true);
  calls.length = 0;

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      createAndActivateConversationInDirectory: async () => {
        calls.push('createAndActivateConversationInDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  assert.equal(calls.includes('setPrompt:null'), true);
  assert.equal(calls.includes('markDirty'), true);
  calls.length = 0;

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        onInsidePointerPress?.(10, 10);
        return true;
      },
      buildNewThreadModalOverlay: () => null,
      resolveNewThreadPromptAgentByRow: () => 'claude',
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        threadQueued.push(task);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`create:${directoryId}:${agentType}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  assert.equal(calls.length, 0);

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        onInsidePointerPress?.(10, 10);
        return true;
      },
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        threadQueued.push(task);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`create:${directoryId}:${agentType}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  assert.equal(calls.length, 0);

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('\u001b[<0;10;10M', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) =>
        onInsidePointerPress?.(10, 10) === true,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => 'claude',
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        threadQueued.push(task);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`create:${directoryId}:${agentType}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  while (threadQueued.length > 0) {
    await threadQueued.shift()?.();
  }
  assert.equal(calls.includes('queue:modal-new-thread-click:claude'), true);
  calls.length = 0;

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from(' ', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        threadQueued.push(task);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`create:${directoryId}:${agentType}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  assert.equal(calls.includes('setPrompt:claude'), true);
  calls.length = 0;

  assert.equal(
    handleNewThreadPromptInput({
      input: Buffer.from('\n', 'utf8'),
      prompt,
      isQuitShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildNewThreadModalOverlay: () => ({ top: 1 }),
      resolveNewThreadPromptAgentByRow: () => null,
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        threadQueued.push(task);
      },
      createAndActivateConversationInDirectory: async (directoryId, agentType) => {
        calls.push(`create:${directoryId}:${agentType}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setPrompt: (next) => {
        calls.push(`setPrompt:${next === null ? 'null' : next.selectedAgentType}`);
      },
    }),
    true,
  );
  while (threadQueued.length > 0) {
    await threadQueued.shift()?.();
  }
  assert.equal(calls.includes('queue:modal-new-thread:codex'), true);
});

void test('modal overlay builders return null for missing state and build overlays for active prompts', () => {
  const theme = {} as Parameters<typeof buildNewThreadModalOverlay>[3];
  assert.equal(buildCommandMenuModalOverlay(80, 24, null, [], theme), null);
  const commandMenuOverlay = buildCommandMenuModalOverlay(
    80,
    24,
    createCommandMenuState(),
    [
      {
        id: 'start.cursor',
        title: 'Start Cursor thread',
        aliases: ['cur'],
      },
    ],
    theme,
  );
  assert.notEqual(commandMenuOverlay, null);
  const themeCommandMenuOverlay = buildCommandMenuModalOverlay(
    80,
    24,
    createCommandMenuState({
      scope: 'theme-select',
    }),
    [
      {
        id: 'theme.set.github',
        title: 'github',
      },
    ],
    theme,
  );
  assert.notEqual(themeCommandMenuOverlay, null);
  const themeOverlayRows = themeCommandMenuOverlay?.rows ?? [];
  assert.equal(
    themeOverlayRows.some((row) => row.includes('Choose Theme')),
    true,
  );
  assert.equal(
    themeOverlayRows.some((row) => row.includes('enter apply')),
    true,
  );
  assert.equal(
    themeOverlayRows.some((row) => row.includes('type to filter themes')),
    true,
  );
  const pagedCommandMenuOverlay = buildCommandMenuModalOverlay(
    80,
    24,
    {
      scope: 'all',
      query: 'action',
      selectedIndex: 9,
    },
    Array.from({ length: 12 }, (_, index) => ({
      id: `action.${String(index)}`,
      title: `Action ${String(index).padStart(2, '0')}`,
    })),
    theme,
  );
  assert.notEqual(pagedCommandMenuOverlay, null);
  const pagedRows = pagedCommandMenuOverlay?.rows ?? [];
  assert.equal(
    pagedRows.some((row) => row.includes('results 9-12 of 12')),
    false,
  );

  assert.equal(buildNewThreadModalOverlay(80, 24, null, theme), null);
  const newThreadOverlay = buildNewThreadModalOverlay(
    80,
    24,
    createNewThreadPromptState('dir-a'),
    theme,
  );
  assert.notEqual(newThreadOverlay, null);

  assert.equal(buildAddDirectoryModalOverlay(80, 24, null, theme), null);
  const addDirectoryOverlay = buildAddDirectoryModalOverlay(
    80,
    24,
    { value: '', error: null },
    theme,
  );
  assert.notEqual(addDirectoryOverlay, null);
  const addDirectoryErrorOverlay = buildAddDirectoryModalOverlay(
    80,
    24,
    { value: 'repo', error: 'bad path' },
    theme,
  );
  assert.notEqual(addDirectoryErrorOverlay, null);

  assert.equal(
    buildTaskEditorModalOverlay(80, 24, null, () => null, theme),
    null,
  );
  const taskEditorOverlay = buildTaskEditorModalOverlay(
    80,
    24,
    {
      mode: 'create',
      title: 'Task',
      description: 'Desc',
      repositoryIds: ['repo-a'],
      repositoryIndex: 0,
      fieldIndex: 0,
      error: null,
    },
    () => 'Repo A',
    theme,
  );
  assert.notEqual(taskEditorOverlay, null);
  const taskEditorErrorOverlay = buildTaskEditorModalOverlay(
    80,
    24,
    {
      mode: 'edit',
      title: 'Task',
      description: 'Desc',
      repositoryIds: [],
      repositoryIndex: 0,
      fieldIndex: 2,
      error: 'title required',
    },
    () => null,
    theme,
  );
  assert.notEqual(taskEditorErrorOverlay, null);

  assert.equal(buildRepositoryModalOverlay(80, 24, null, theme), null);
  const repositoryAddOverlay = buildRepositoryModalOverlay(
    80,
    24,
    { mode: 'add', value: '', error: null },
    theme,
  );
  assert.notEqual(repositoryAddOverlay, null);
  const repositoryEditOverlay = buildRepositoryModalOverlay(
    80,
    24,
    { mode: 'edit', value: 'https://github.com/org/repo', error: 'bad url' },
    theme,
  );
  assert.notEqual(repositoryEditOverlay, null);
  const repositoryEditNoErrorOverlay = buildRepositoryModalOverlay(
    80,
    24,
    { mode: 'edit', value: 'https://github.com/org/repo', error: null },
    theme,
  );
  assert.notEqual(repositoryEditNoErrorOverlay, null);

  assert.equal(buildApiKeyModalOverlay(80, 24, null, theme), null);
  const apiKeyWarningOverlay = buildApiKeyModalOverlay(
    80,
    24,
    {
      keyName: 'OPENAI_API_KEY',
      displayName: 'OpenAI API Key',
      value: '',
      error: null,
      hasExistingValue: true,
    },
    theme,
  );
  assert.notEqual(apiKeyWarningOverlay, null);
  assert.equal(
    apiKeyWarningOverlay?.rows.some((row) => row.includes('warning: existing value')),
    true,
  );
  const apiKeyErrorOverlay = buildApiKeyModalOverlay(
    80,
    24,
    {
      keyName: 'OPENAI_API_KEY',
      displayName: 'OpenAI API Key',
      value: '',
      error: 'missing value',
      hasExistingValue: true,
    },
    theme,
  );
  assert.equal(
    apiKeyErrorOverlay?.rows.some((row) => row.includes('error: missing value')),
    true,
  );
  const apiKeyEmptyOverlay = buildApiKeyModalOverlay(
    80,
    24,
    {
      keyName: 'OPENAI_API_KEY',
      displayName: 'OpenAI API Key',
      value: '',
      error: null,
      hasExistingValue: false,
    },
    theme,
  );
  assert.equal(
    apiKeyEmptyOverlay?.rows.some((row) => row.includes('user-global')),
    true,
  );

  assert.equal(buildConversationTitleModalOverlay(80, 24, null, theme), null);
  const titlePendingOverlay = buildConversationTitleModalOverlay(
    80,
    24,
    {
      value: 'Draft',
      lastSavedValue: 'Saved',
      error: null,
      persistInFlight: false,
    },
    theme,
  );
  assert.notEqual(titlePendingOverlay, null);
  const titleSavedOverlay = buildConversationTitleModalOverlay(
    80,
    24,
    {
      value: 'Saved',
      lastSavedValue: 'Saved',
      error: null,
      persistInFlight: false,
    },
    theme,
  );
  assert.notEqual(titleSavedOverlay, null);
  const titleSavingOverlay = buildConversationTitleModalOverlay(
    80,
    24,
    {
      value: 'Saving',
      lastSavedValue: 'Saved',
      error: 'failed',
      persistInFlight: true,
    },
    theme,
  );
  assert.notEqual(titleSavingOverlay, null);
});
