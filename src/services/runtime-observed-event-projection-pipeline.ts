import type { StreamObservedEvent } from '../control-plane/stream-protocol.ts';
import {
  applyObservedEventToHarnessSyncedStore,
  type HarnessSyncedStore,
  type HarnessSyncedStoreApplyResult,
} from '../core/store/harness-synced-store.ts';

export interface RuntimeObservedEventProjectionInput {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly event: StreamObservedEvent;
}

export interface RuntimeObservedEventProjectionResult {
  readonly cursorAccepted: boolean;
  readonly previousCursor: number | null;
}

export interface RuntimeObservedEventProjectionPipelineOptions {
  readonly syncedStore: HarnessSyncedStore;
  readonly applyWorkspaceProjection: (reduction: HarnessSyncedStoreApplyResult) => void;
  readonly applyTaskPlanningProjection: (reduction: HarnessSyncedStoreApplyResult) => void;
  readonly applyDirectoryGitProjection: (event: StreamObservedEvent) => void;
}

export function applyRuntimeObservedEventProjection(
  input: RuntimeObservedEventProjectionInput,
  options: RuntimeObservedEventProjectionPipelineOptions,
): RuntimeObservedEventProjectionResult {
  const reduced = applyObservedEventToHarnessSyncedStore(options.syncedStore, input);
  if (!reduced.cursorAccepted) {
    return {
      cursorAccepted: false,
      previousCursor: reduced.previousCursor,
    };
  }
  options.applyWorkspaceProjection(reduced);
  // Directory git status updates remain an explicit non-synced projection boundary.
  options.applyDirectoryGitProjection(input.event);
  options.applyTaskPlanningProjection(reduced);
  return {
    cursorAccepted: true,
    previousCursor: reduced.previousCursor,
  };
}
