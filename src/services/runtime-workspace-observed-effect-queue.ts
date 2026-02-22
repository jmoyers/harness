import type { RuntimeWorkspaceObservedQueuedReaction } from './runtime-workspace-observed-transition-policy.ts';

export interface RuntimeWorkspaceObservedEffectQueueOptions {
  // Must enqueue work; callers should not execute reactions inline from the subscriber path.
  readonly enqueueQueuedReaction: (task: () => Promise<void>, label: string) => void;
  readonly unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  readonly activateConversation: (sessionId: string) => Promise<void>;
}

export class RuntimeWorkspaceObservedEffectQueue {
  constructor(private readonly options: RuntimeWorkspaceObservedEffectQueueOptions) {}

  enqueueAll(reactions: readonly RuntimeWorkspaceObservedQueuedReaction[]): void {
    for (const reaction of reactions) {
      this.enqueueReaction(reaction);
    }
  }

  private enqueueReaction(reaction: RuntimeWorkspaceObservedQueuedReaction): void {
    if (reaction.kind === 'unsubscribe-conversation') {
      this.options.enqueueQueuedReaction(async () => {
        await this.options.unsubscribeConversationEvents(reaction.sessionId);
      }, reaction.label);
      return;
    }
    this.options.enqueueQueuedReaction(async () => {
      await this.options.activateConversation(reaction.sessionId);
    }, reaction.label);
  }
}
