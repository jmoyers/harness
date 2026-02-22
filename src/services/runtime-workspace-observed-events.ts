import type { HarnessSyncedStore } from '../core/store/harness-synced-store.ts';
import type { RuntimeWorkspaceObservedEffectQueue } from './runtime-workspace-observed-effect-queue.ts';
import {
  RuntimeWorkspaceObservedTransitionPolicy,
  type RuntimeWorkspaceObservedTransitionPolicyOptions,
} from './runtime-workspace-observed-transition-policy.ts';

interface RuntimeWorkspaceObservedEventsOptions {
  readonly store: HarnessSyncedStore;
  readonly orderedConversationIds: () => readonly string[];
  readonly transitionPolicy:
    | RuntimeWorkspaceObservedTransitionPolicy
    | RuntimeWorkspaceObservedTransitionPolicyOptions;
  readonly effectQueue: RuntimeWorkspaceObservedEffectQueue;
  readonly markDirty: () => void;
}

export class RuntimeWorkspaceObservedEvents {
  private unsubscribeStore: (() => void) | null = null;
  private readonly transitionPolicy: RuntimeWorkspaceObservedTransitionPolicy;

  constructor(private readonly options: RuntimeWorkspaceObservedEventsOptions) {
    this.transitionPolicy =
      options.transitionPolicy instanceof RuntimeWorkspaceObservedTransitionPolicy
        ? options.transitionPolicy
        : new RuntimeWorkspaceObservedTransitionPolicy(options.transitionPolicy);
  }

  start(): void {
    if (this.unsubscribeStore !== null) {
      return;
    }
    this.unsubscribeStore = this.options.store.subscribe((state, previousState) => {
      if (state.synced === previousState.synced) {
        return;
      }
      const planned = this.transitionPolicy.apply({
        previous: previousState.synced,
        current: state.synced,
        orderedConversationIds: this.options.orderedConversationIds(),
      });
      this.options.effectQueue.enqueueAll(planned.reactions);
      this.options.markDirty();
    });
  }

  stop(): void {
    if (this.unsubscribeStore === null) {
      return;
    }
    this.unsubscribeStore();
    this.unsubscribeStore = null;
  }
}
