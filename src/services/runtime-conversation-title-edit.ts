import type {
  ConversationTitleEditState,
  WorkspaceModel,
} from '../domain/workspace.ts';

interface ConversationTitleRecordLike {
  title: string;
}

interface RuntimeConversationTitleEditServiceOptions<
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

export class RuntimeConversationTitleEditService<
  TConversation extends ConversationTitleRecordLike,
> {
  private readonly setDebounceTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearDebounceTimer: (timer: NodeJS.Timeout) => void;

  constructor(
    private readonly options: RuntimeConversationTitleEditServiceOptions<TConversation>,
  ) {
    this.setDebounceTimer = options.setDebounceTimer ?? setTimeout;
    this.clearDebounceTimer = options.clearDebounceTimer ?? clearTimeout;
  }

  clearCurrentTimer(): void {
    const edit = this.options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    this.clearTimer(edit);
  }

  schedulePersist(): void {
    const edit = this.options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    this.clearTimer(edit);
    edit.debounceTimer = this.setDebounceTimer(() => {
      const latestEdit = this.options.workspace.conversationTitleEdit;
      if (latestEdit === null || latestEdit.conversationId !== edit.conversationId) {
        return;
      }
      latestEdit.debounceTimer = null;
      this.queuePersist(latestEdit, 'debounced');
    }, this.options.debounceMs);
    edit.debounceTimer.unref?.();
  }

  stop(persistPending: boolean): void {
    const edit = this.options.workspace.conversationTitleEdit;
    if (edit === null) {
      return;
    }
    this.clearTimer(edit);
    if (persistPending) {
      this.queuePersist(edit, 'flush');
    }
    this.options.workspace.conversationTitleEdit = null;
    this.options.markDirty();
  }

  begin(conversationId: string): void {
    const target = this.options.conversationById(conversationId);
    if (target === undefined) {
      return;
    }
    if (this.options.workspace.conversationTitleEdit?.conversationId === conversationId) {
      return;
    }
    if (this.options.workspace.conversationTitleEdit !== null) {
      this.stop(true);
    }
    this.options.workspace.conversationTitleEdit = {
      conversationId,
      value: target.title,
      lastSavedValue: target.title,
      error: null,
      persistInFlight: false,
      debounceTimer: null,
    };
    this.options.markDirty();
  }

  private clearTimer(edit: ConversationTitleEditState): void {
    if (edit.debounceTimer !== null) {
      this.clearDebounceTimer(edit.debounceTimer);
      edit.debounceTimer = null;
    }
  }

  private queuePersist(
    edit: ConversationTitleEditState,
    reason: 'debounced' | 'flush',
  ): void {
    const titleToPersist = edit.value;
    if (titleToPersist === edit.lastSavedValue) {
      return;
    }
    edit.persistInFlight = true;
    this.options.markDirty();
    this.options.queueControlPlaneOp(async () => {
      try {
        const parsed = await this.options.updateConversationTitle({
          conversationId: edit.conversationId,
          title: titleToPersist,
        });
        const persistedTitle = parsed?.title ?? titleToPersist;
        const latestConversation = this.options.conversationById(edit.conversationId);
        const latestEdit = this.options.workspace.conversationTitleEdit;
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
        const latestEdit = this.options.workspace.conversationTitleEdit;
        if (
          latestEdit !== null &&
          latestEdit.conversationId === edit.conversationId &&
          latestEdit.value === titleToPersist
        ) {
          latestEdit.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      } finally {
        const latestEdit = this.options.workspace.conversationTitleEdit;
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.persistInFlight = false;
        }
        this.options.markDirty();
      }
    }, `title-edit-${reason}:${edit.conversationId}`);
  }
}
