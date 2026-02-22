import type { StreamObservedEvent } from '../../control-plane/stream-protocol.ts';
import {
  parseConversationRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
  parseTaskRecord,
  type ControlPlaneConversationRecord,
  type ControlPlaneDirectoryRecord,
  type ControlPlaneRepositoryRecord,
  type ControlPlaneTaskRecord,
} from '../contracts/records.ts';

export interface HarnessSyncedState {
  readonly directoriesById: Readonly<Record<string, ControlPlaneDirectoryRecord>>;
  readonly conversationsById: Readonly<Record<string, ControlPlaneConversationRecord>>;
  readonly repositoriesById: Readonly<Record<string, ControlPlaneRepositoryRecord>>;
  readonly tasksById: Readonly<Record<string, ControlPlaneTaskRecord>>;
}

export interface HarnessSyncedObservedReduction {
  readonly state: HarnessSyncedState;
  readonly changed: boolean;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
  readonly removedTaskIds: readonly string[];
  readonly upsertedDirectoryIds: readonly string[];
  readonly upsertedConversationIds: readonly string[];
  readonly upsertedRepositoryIds: readonly string[];
  readonly upsertedTaskIds: readonly string[];
}

const EMPTY_IDS: readonly string[] = [];

export function createHarnessSyncedState(): HarnessSyncedState {
  return {
    directoriesById: {},
    conversationsById: {},
    repositoriesById: {},
    tasksById: {},
  };
}

function unchanged(state: HarnessSyncedState): HarnessSyncedObservedReduction {
  return {
    state,
    changed: false,
    removedConversationIds: EMPTY_IDS,
    removedDirectoryIds: EMPTY_IDS,
    removedTaskIds: EMPTY_IDS,
    upsertedDirectoryIds: EMPTY_IDS,
    upsertedConversationIds: EMPTY_IDS,
    upsertedRepositoryIds: EMPTY_IDS,
    upsertedTaskIds: EMPTY_IDS,
  };
}

export function applyObservedEventToSyncedState(
  state: HarnessSyncedState,
  event: StreamObservedEvent,
): HarnessSyncedObservedReduction {
  if (event.type === 'directory-upserted') {
    const directory = parseDirectoryRecord(event.directory);
    if (directory === null) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        directoriesById: {
          ...state.directoriesById,
          [directory.directoryId]: directory,
        },
      },
      changed: true,
      upsertedDirectoryIds: [directory.directoryId],
    };
  }

  if (event.type === 'directory-archived') {
    const removedConversationIds: string[] = [];
    const nextConversations = { ...state.conversationsById };
    for (const [conversationId, conversation] of Object.entries(state.conversationsById)) {
      if (conversation.directoryId !== event.directoryId) {
        continue;
      }
      delete nextConversations[conversationId];
      removedConversationIds.push(conversationId);
    }
    const directoryExisted = state.directoriesById[event.directoryId] !== undefined;
    if (!directoryExisted && removedConversationIds.length === 0) {
      return unchanged(state);
    }
    const nextDirectories = { ...state.directoriesById };
    delete nextDirectories[event.directoryId];
    return {
      ...unchanged(state),
      state: {
        ...state,
        directoriesById: nextDirectories,
        conversationsById: nextConversations,
      },
      changed: true,
      removedConversationIds,
      removedDirectoryIds: directoryExisted ? [event.directoryId] : EMPTY_IDS,
    };
  }

  if (event.type === 'conversation-created' || event.type === 'conversation-updated') {
    const conversation = parseConversationRecord(event.conversation);
    if (conversation === null) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        conversationsById: {
          ...state.conversationsById,
          [conversation.conversationId]: conversation,
        },
      },
      changed: true,
      upsertedConversationIds: [conversation.conversationId],
    };
  }

  if (event.type === 'conversation-archived' || event.type === 'conversation-deleted') {
    if (state.conversationsById[event.conversationId] === undefined) {
      return unchanged(state);
    }
    const nextConversations = { ...state.conversationsById };
    delete nextConversations[event.conversationId];
    return {
      ...unchanged(state),
      state: {
        ...state,
        conversationsById: nextConversations,
      },
      changed: true,
      removedConversationIds: [event.conversationId],
    };
  }

  if (event.type === 'repository-upserted' || event.type === 'repository-updated') {
    const repository = parseRepositoryRecord(event.repository);
    if (repository === null) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        repositoriesById: {
          ...state.repositoriesById,
          [repository.repositoryId]: repository,
        },
      },
      changed: true,
      upsertedRepositoryIds: [repository.repositoryId],
    };
  }

  if (event.type === 'repository-archived') {
    const existing = state.repositoriesById[event.repositoryId];
    if (existing === undefined) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        repositoriesById: {
          ...state.repositoriesById,
          [event.repositoryId]: {
            ...existing,
            archivedAt: event.ts,
          },
        },
      },
      changed: true,
      upsertedRepositoryIds: [event.repositoryId],
    };
  }

  if (event.type === 'task-created' || event.type === 'task-updated') {
    const task = parseTaskRecord(event.task);
    if (task === null) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        tasksById: {
          ...state.tasksById,
          [task.taskId]: task,
        },
      },
      changed: true,
      upsertedTaskIds: [task.taskId],
    };
  }

  if (event.type === 'task-deleted') {
    if (state.tasksById[event.taskId] === undefined) {
      return unchanged(state);
    }
    const nextTasks = { ...state.tasksById };
    delete nextTasks[event.taskId];
    return {
      ...unchanged(state),
      state: {
        ...state,
        tasksById: nextTasks,
      },
      changed: true,
      removedTaskIds: [event.taskId],
    };
  }

  if (event.type === 'task-reordered') {
    const nextTasks = { ...state.tasksById };
    const upsertedTaskIds: string[] = [];
    for (const value of event.tasks) {
      const task = parseTaskRecord(value);
      if (task === null) {
        continue;
      }
      nextTasks[task.taskId] = task;
      upsertedTaskIds.push(task.taskId);
    }
    if (upsertedTaskIds.length === 0) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        tasksById: nextTasks,
      },
      changed: true,
      upsertedTaskIds,
    };
  }

  if (event.type === 'session-status') {
    const conversationId = event.conversationId ?? event.sessionId;
    const existing = state.conversationsById[conversationId];
    if (existing === undefined) {
      return unchanged(state);
    }
    return {
      ...unchanged(state),
      state: {
        ...state,
        conversationsById: {
          ...state.conversationsById,
          [conversationId]: {
            ...existing,
            runtimeStatus: event.status,
            runtimeStatusModel: event.statusModel,
            runtimeLive: event.live,
          },
        },
      },
      changed: true,
      upsertedConversationIds: [conversationId],
    };
  }

  return unchanged(state);
}
