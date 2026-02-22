import type { TaskComposerBuffer } from '../../mux/task-composer.ts';
import type {
  TaskFocusedPaneRepositoryRecord,
  TaskFocusedPaneTaskRecord,
} from '../../mux/task-focused-pane.ts';
import type { RuntimeRenderPipelineSnapshot } from '../../services/runtime-render-pipeline.ts';
import { snapshotTaskComposerBuffers } from '../../services/runtime-task-composer-snapshot.ts';

interface TuiRenderSnapshotConversationLookup<TConversation> {
  readonlyConversations(): ReadonlyMap<string, TConversation>;
  orderedIds(): readonly string[];
  readonly activeConversationId: string | null;
}

interface TuiRenderSnapshotDirectoryLookup<TDirectoryRecord> {
  readonlyDirectories(): ReadonlyMap<string, TDirectoryRecord>;
}

interface TuiRenderSnapshotRepositoryLookup<
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
> {
  readonlyRepositories(): ReadonlyMap<string, TRepositoryRecord>;
}

interface TuiRenderSnapshotTaskLookup<
  TTaskRecord extends TaskFocusedPaneTaskRecord,
> {
  readonlyTasks(): ReadonlyMap<string, TTaskRecord>;
  readonlyTaskComposers(): ReadonlyMap<string, TaskComposerBuffer>;
}

interface TuiRenderSnapshotProcessUsageLookup<TProcessUsage> {
  readonlyUsage(): ReadonlyMap<string, TProcessUsage>;
}

export interface TuiRenderSnapshotAdapterOptions<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TProcessUsage,
> {
  readonly directories: TuiRenderSnapshotDirectoryLookup<TDirectoryRecord>;
  readonly conversations: TuiRenderSnapshotConversationLookup<TConversation>;
  readonly repositories: TuiRenderSnapshotRepositoryLookup<TRepositoryRecord>;
  readonly tasks: TuiRenderSnapshotTaskLookup<TTaskRecord>;
  readonly processUsage: TuiRenderSnapshotProcessUsageLookup<TProcessUsage>;
  readonly snapshotTaskComposers?: (
    taskComposers: ReadonlyMap<string, TaskComposerBuffer>,
  ) => ReadonlyMap<string, TaskComposerBuffer>;
}

export class TuiRenderSnapshotAdapter<
  TDirectoryRecord,
  TConversation,
  TRepositoryRecord extends TaskFocusedPaneRepositoryRecord,
  TTaskRecord extends TaskFocusedPaneTaskRecord,
  TProcessUsage,
> {
  private readonly snapshotTaskComposers: (
    taskComposers: ReadonlyMap<string, TaskComposerBuffer>,
  ) => ReadonlyMap<string, TaskComposerBuffer>;

  constructor(
    private readonly options: TuiRenderSnapshotAdapterOptions<
      TDirectoryRecord,
      TConversation,
      TRepositoryRecord,
      TTaskRecord,
      TProcessUsage
    >,
  ) {
    this.snapshotTaskComposers = options.snapshotTaskComposers ?? snapshotTaskComposerBuffers;
  }

  readSnapshot(): RuntimeRenderPipelineSnapshot<
    TDirectoryRecord,
    TConversation,
    TRepositoryRecord,
    TTaskRecord,
    TProcessUsage
  > {
    return {
      leftRail: {
        repositories: this.options.repositories.readonlyRepositories(),
        directories: this.options.directories.readonlyDirectories(),
        conversations: this.options.conversations.readonlyConversations(),
        orderedConversationIds: this.options.conversations.orderedIds(),
        processUsageBySessionId: this.options.processUsage.readonlyUsage(),
        activeConversationId: this.options.conversations.activeConversationId,
      },
      rightPane: {
        repositories: this.options.repositories.readonlyRepositories(),
        tasks: this.options.tasks.readonlyTasks(),
        taskComposers: this.snapshotTaskComposers(this.options.tasks.readonlyTaskComposers()),
      },
    };
  }
}
