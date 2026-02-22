import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StreamObservedEvent } from '../../control-plane/stream-protocol.ts';
import {
  createObservedStreamCursorState,
  observeStreamCursor,
  type ObservedStreamCursorState,
} from '../state/observed-stream-cursor.ts';
import {
  applyObservedEventToSyncedState,
  createHarnessSyncedState,
  type HarnessSyncedObservedReduction,
  type HarnessSyncedState,
} from '../state/synced-observed-state.ts';

export interface HarnessSyncedStoreState {
  readonly synced: HarnessSyncedState;
  readonly observedStreamCursor: ObservedStreamCursorState;
}

export interface HarnessSyncedStoreApplyInput {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly event: StreamObservedEvent;
}

export interface HarnessSyncedStoreApplyResult extends HarnessSyncedObservedReduction {
  readonly cursorAccepted: boolean;
  readonly previousCursor: number | null;
  readonly previousState: HarnessSyncedState;
}

export type HarnessSyncedStore = StoreApi<HarnessSyncedStoreState>;

export function createHarnessSyncedStore(
  initial: Partial<HarnessSyncedStoreState> = {},
): HarnessSyncedStore {
  return createStore<HarnessSyncedStoreState>(() => ({
    synced: initial.synced ?? createHarnessSyncedState(),
    observedStreamCursor: initial.observedStreamCursor ?? createObservedStreamCursorState(),
  }));
}

export function applyObservedEventToHarnessSyncedStore(
  store: HarnessSyncedStore,
  input: HarnessSyncedStoreApplyInput,
): HarnessSyncedStoreApplyResult {
  const state = store.getState();
  const observedCursor = observeStreamCursor(state.observedStreamCursor, {
    subscriptionId: input.subscriptionId,
    cursor: input.cursor,
  });

  if (!observedCursor.accepted) {
    return {
      state: state.synced,
      changed: false,
      cursorAccepted: false,
      previousCursor: observedCursor.previousCursor,
      previousState: state.synced,
      removedConversationIds: [],
      removedDirectoryIds: [],
      removedTaskIds: [],
      upsertedDirectoryIds: [],
      upsertedConversationIds: [],
      upsertedRepositoryIds: [],
      upsertedTaskIds: [],
    };
  }

  const reduced = applyObservedEventToSyncedState(state.synced, input.event);
  store.setState({
    observedStreamCursor: observedCursor.state,
    synced: reduced.state,
  });
  return {
    ...reduced,
    cursorAccepted: true,
    previousCursor: observedCursor.previousCursor,
    previousState: state.synced,
  };
}
