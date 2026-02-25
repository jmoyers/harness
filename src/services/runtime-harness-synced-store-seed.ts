import type {
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneRepositoryRecord,
  ControlPlaneTaskRecord,
} from '../core/contracts/records.ts';
import type { HarnessSyncedStore } from '../core/store/harness-synced-store.ts';
import type { ConversationState } from '../mux/live-mux/conversation-state.ts';

interface RuntimeSyncedStoreSeedInput {
  readonly store: HarnessSyncedStore;
  readonly directories: ReadonlyMap<string, ControlPlaneDirectoryRecord>;
  readonly conversations: ReadonlyMap<string, ConversationState>;
  readonly repositories: ReadonlyMap<string, ControlPlaneRepositoryRecord>;
  readonly tasks: ReadonlyMap<string, ControlPlaneTaskRecord>;
}

function toConversationRecord(
  conversation: ConversationState,
): ControlPlaneConversationRecord | null {
  if (conversation.directoryId === null) {
    return null;
  }
  return {
    conversationId: conversation.sessionId,
    directoryId: conversation.directoryId,
    tenantId: conversation.scope.tenantId,
    userId: conversation.scope.userId,
    workspaceId: conversation.scope.workspaceId,
    title: conversation.title,
    agentType: conversation.agentType,
    adapterState: conversation.adapterState,
    runtimeStatus: conversation.status,
    runtimeStatusModel: conversation.statusModel,
    runtimeLive: conversation.live,
  };
}

export function seedRuntimeHarnessSyncedStore(input: RuntimeSyncedStoreSeedInput): void {
  const directoriesById: Record<string, ControlPlaneDirectoryRecord> = {};
  for (const [directoryId, directory] of input.directories) {
    directoriesById[directoryId] = directory;
  }

  const conversationsById: Record<string, ControlPlaneConversationRecord> = {};
  for (const conversation of input.conversations.values()) {
    const record = toConversationRecord(conversation);
    if (record !== null) {
      conversationsById[record.conversationId] = record;
    }
  }

  const repositoriesById: Record<string, ControlPlaneRepositoryRecord> = {};
  for (const [repositoryId, repository] of input.repositories) {
    repositoriesById[repositoryId] = repository;
  }

  const tasksById: Record<string, ControlPlaneTaskRecord> = {};
  for (const [taskId, task] of input.tasks) {
    tasksById[taskId] = task;
  }

  input.store.setState((state) => ({
    ...state,
    synced: {
      directoriesById,
      conversationsById,
      repositoriesById,
      tasksById,
    },
  }));
}
