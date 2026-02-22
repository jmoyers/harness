import type { ConversationTitleEditState, WorkspaceModel } from '../domain/workspace.ts';

interface ConversationTitleRecordLike {
  title: string;
}

export interface RuntimeConversationTitleEditServiceOptions<
  TConversation extends ConversationTitleRecordLike,
> {
  readonly workspace: WorkspaceModel;
  readonly updateConversationTitle: (input: {
    conversationId: string;
    title: string;
  }) => Promise<{ title: string } | null>;
  readonly conversationById: (conversationId: string) => TConversation | undefined;
  readonly markDirty: () => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly debounceMs: number;
  readonly setDebounceTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  readonly clearDebounceTimer?: (timer: NodeJS.Timeout) => void;
}

export interface RuntimeConversationTitleEditService {
  clearCurrentTimer(): void;
  schedulePersist(): void;
  stop(persistPending: boolean): void;
  begin(conversationId: string): void;
}

export function createRuntimeConversationTitleEditService<
  TConversation extends ConversationTitleRecordLike,
>(
  options: RuntimeConversationTitleEditServiceOptions<TConversation>,
): RuntimeConversationTitleEditService {
  const setDebounceTimer = options.setDebounceTimer ?? setTimeout;
  const clearDebounceTimer = options.clearDebounceTimer ?? clearTimeout;

  function clearTimer(edit: ConversationTitleEditState): void {
    if (edit.debounceTimer !== null) {
      clearDebounceTimer(edit.debounceTimer);
      edit.debounceTimer = null;
    }
  }

  function queuePersist(edit: ConversationTitleEditState, reason: 'debounced' | 'flush'): void {
    const titleToPersist = edit.value;
    if (titleToPersist === edit.lastSavedValue) {
      return;
    }
    edit.persistInFlight = true;
    options.markDirty();
    options.queueControlPlaneOp(async () => {
      try {
        const parsed = await options.updateConversationTitle({
          conversationId: edit.conversationId,
          title: titleToPersist,
        });
        const persistedTitle = parsed?.title ?? titleToPersist;
        const latestConversation = options.conversationById(edit.conversationId);
        const latestEdit = options.workspace.conversationTitleEdit;
        const shouldApplyToConversation =
          latestEdit === null ||
          latestEdit.conversationId !== edit.conversationId ||
          latestEdit.value === titleToPersist;
        if (latestConversation !== undefined && shouldApplyToConversation) {
          latestConversation.title = persistedTitle;
        }
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.lastSavedValue = persistedTitle;
          if (latestEdit.value === titleToPersist) {
            latestEdit.error = null;
          }
        }
      } catch (error: unknown) {
        const latestEdit = options.workspace.conversationTitleEdit;
        if (
          latestEdit !== null &&
          latestEdit.conversationId === edit.conversationId &&
          latestEdit.value === titleToPersist
        ) {
          latestEdit.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      } finally {
        const latestEdit = options.workspace.conversationTitleEdit;
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.persistInFlight = false;
        }
        options.markDirty();
      }
    }, `title-edit-${reason}:${edit.conversationId}`);
  }

  function clearCurrentTimer(): void {
    const edit = options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearTimer(edit);
  }

  function schedulePersist(): void {
    const edit = options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearTimer(edit);
    edit.debounceTimer = setDebounceTimer(() => {
      const latestEdit = options.workspace.conversationTitleEdit;
      if (latestEdit === null || latestEdit.conversationId !== edit.conversationId) {
        return;
      }
      latestEdit.debounceTimer = null;
      queuePersist(latestEdit, 'debounced');
    }, options.debounceMs);
    edit.debounceTimer.unref?.();
  }

  function stop(persistPending: boolean): void {
    const edit = options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearTimer(edit);
    if (persistPending) {
      queuePersist(edit, 'flush');
    }
    options.workspace.conversationTitleEdit = null;
    options.markDirty();
  }

  function begin(conversationId: string): void {
    const target = options.conversationById(conversationId);
    if (target === undefined) {
      return;
    }
    if (options.workspace.conversationTitleEdit?.conversationId === conversationId) {
      return;
    }
    if (options.workspace.conversationTitleEdit !== null) {
      stop(true);
    }
    options.workspace.conversationTitleEdit = {
      conversationId,
      value: target.title,
      lastSavedValue: target.title,
      error: null,
      persistInFlight: false,
      debounceTimer: null,
    };
    options.markDirty();
  }

  return {
    clearCurrentTimer,
    schedulePersist,
    stop,
    begin,
  };
}
