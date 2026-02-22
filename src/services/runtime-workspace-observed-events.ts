import type { HarnessSyncedStore } from '../core/store/harness-synced-store.ts';
import {
  enqueueRuntimeWorkspaceObservedReactions,
  type RuntimeWorkspaceObservedEffectQueueOptions,
} from './runtime-workspace-observed-effect-queue.ts';
import {
  planRuntimeWorkspaceObservedTransition,
  type RuntimeWorkspaceObservedTransitionPolicyOptions,
} from './runtime-workspace-observed-transition-policy.ts';

export interface RuntimeWorkspaceObservedEventsOptions {
  readonly store: HarnessSyncedStore;
  readonly orderedConversationIds: () => readonly string[];
  readonly transitionPolicy: RuntimeWorkspaceObservedTransitionPolicyOptions;
  readonly effectQueue: RuntimeWorkspaceObservedEffectQueueOptions;
  readonly markDirty: () => void;
}

export function subscribeRuntimeWorkspaceObservedEvents(
  options: RuntimeWorkspaceObservedEventsOptions,
): () => void {
  return options.store.subscribe((state, previousState) => {
    if (state.synced === previousState.synced) {
      return;
    }
    const planned = planRuntimeWorkspaceObservedTransition({
      transition: {
        previous: previousState.synced,
        current: state.synced,
        orderedConversationIds: options.orderedConversationIds(),
      },
      options: options.transitionPolicy,
    });
    enqueueRuntimeWorkspaceObservedReactions({
      reactions: planned.reactions,
      options: options.effectQueue,
    });
    options.markDirty();
  });
}
