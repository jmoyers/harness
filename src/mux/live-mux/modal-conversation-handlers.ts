import {
  type createNewThreadPromptState,
  reduceNewThreadPromptInput,
  type normalizeThreadAgentType,
} from '../new-thread-prompt.ts';
import { reduceLinePromptInput } from './modal-input-reducers.ts';

type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;
type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;

interface ConversationTitleEditState {
  conversationId: string;
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
  debounceTimer: NodeJS.Timeout | null;
}

interface HandleConversationTitleEditInputOptions {
  input: Buffer;
  edit: ConversationTitleEditState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  isArchiveShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  buildConversationTitleModalOverlay: () => { top: number } | null;
  stopConversationTitleEdit: (persistPending: boolean) => void;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  archiveConversation: (sessionId: string) => Promise<void>;
  markDirty: () => void;
  conversations: ReadonlyMap<string, { title: string }>;
  scheduleConversationTitlePersist: () => void;
}

interface HandleNewThreadPromptInputOptions {
  input: Buffer;
  prompt: NewThreadPromptState | null;
  isQuitShortcut: (input: Buffer) => boolean;
  dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  buildNewThreadModalOverlay: () => { top: number } | null;
  resolveNewThreadPromptAgentByRow: (overlayTop: number, row: number) => ThreadAgentType | null;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  createAndActivateConversationInDirectory: (
    directoryId: string,
    agentType: ThreadAgentType,
  ) => Promise<void>;
  markDirty: () => void;
  setPrompt: (prompt: NewThreadPromptState | null) => void;
}

export function handleConversationTitleEditInput(
  options: HandleConversationTitleEditInputOptions,
): boolean {
  const {
    input,
    edit,
    isQuitShortcut,
    isArchiveShortcut,
    dismissOnOutsideClick,
    buildConversationTitleModalOverlay,
    stopConversationTitleEdit,
    queueControlPlaneOp,
    archiveConversation,
    markDirty,
    conversations,
    scheduleConversationTitlePersist,
  } = options;
  if (edit === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    stopConversationTitleEdit(true);
    return true;
  }
  if (isArchiveShortcut(input)) {
    const targetConversationId = edit.conversationId;
    stopConversationTitleEdit(true);
    queueControlPlaneOp(async () => {
      await archiveConversation(targetConversationId);
    }, 'modal-archive-conversation');
    markDirty();
    return true;
  }
  if (
    dismissOnOutsideClick(
      input,
      () => {
        stopConversationTitleEdit(true);
      },
      (_col, row) => {
        const overlay = buildConversationTitleModalOverlay();
        if (overlay === null) {
          return false;
        }
        const archiveButtonRow = overlay.top + 5;
        if (row - 1 !== archiveButtonRow) {
          return false;
        }
        const targetConversationId = edit.conversationId;
        stopConversationTitleEdit(true);
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'modal-archive-conversation-click');
        markDirty();
        return true;
      },
    )
  ) {
    return true;
  }

  const reduced = reduceLinePromptInput(edit.value, input);
  const nextValue = reduced.value;
  const done = reduced.submit;

  if (nextValue !== edit.value) {
    edit.value = nextValue;
    edit.error = null;
    const conversation = conversations.get(edit.conversationId);
    if (conversation !== undefined) {
      conversation.title = nextValue;
    }
    scheduleConversationTitlePersist();
    markDirty();
  }

  if (done) {
    stopConversationTitleEdit(true);
  }
  return true;
}

export function handleNewThreadPromptInput(options: HandleNewThreadPromptInputOptions): boolean {
  const {
    input,
    prompt,
    isQuitShortcut,
    dismissOnOutsideClick,
    buildNewThreadModalOverlay,
    resolveNewThreadPromptAgentByRow,
    queueControlPlaneOp,
    createAndActivateConversationInDirectory,
    markDirty,
    setPrompt,
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
  const maybeMouseSequence = input.includes(0x3c);
  if (
    maybeMouseSequence &&
    dismissOnOutsideClick(
      input,
      () => {
        setPrompt(null);
        markDirty();
      },
      (_col, row) => {
        const overlay = buildNewThreadModalOverlay();
        if (overlay === null) {
          return false;
        }
        const selectedAgentType = resolveNewThreadPromptAgentByRow(overlay.top, row);
        if (selectedAgentType === null) {
          return false;
        }
        const targetDirectoryId = prompt.directoryId;
        setPrompt(null);
        queueControlPlaneOp(async () => {
          await createAndActivateConversationInDirectory(targetDirectoryId, selectedAgentType);
        }, `modal-new-thread-click:${selectedAgentType}`);
        markDirty();
        return true;
      },
    )
  ) {
    return true;
  }

  const reduction = reduceNewThreadPromptInput(prompt, input);
  const changed = reduction.nextState.selectedAgentType !== prompt.selectedAgentType;

  if (changed) {
    setPrompt(reduction.nextState);
    markDirty();
  }
  if (reduction.submit) {
    const targetDirectoryId = prompt.directoryId;
    const selectedAgentType = reduction.nextState.selectedAgentType;
    setPrompt(null);
    queueControlPlaneOp(async () => {
      await createAndActivateConversationInDirectory(targetDirectoryId, selectedAgentType);
    }, `modal-new-thread:${selectedAgentType}`);
    markDirty();
    return true;
  }
  return true;
}
