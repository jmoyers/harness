import type { RuntimeWorkspaceObservedQueuedReaction } from './runtime-workspace-observed-transition-policy.ts';

export interface RuntimeWorkspaceObservedEffectQueueOptions {
  // Must enqueue work; callers should not execute reactions inline from the subscriber path.
  readonly enqueueQueuedReaction: (task: () => Promise<void>, label: string) => void;
  readonly unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  readonly activateConversation: (sessionId: string) => Promise<void>;
}

export function enqueueRuntimeWorkspaceObservedReactions(input: {
  readonly reactions: readonly RuntimeWorkspaceObservedQueuedReaction[];
  readonly options: RuntimeWorkspaceObservedEffectQueueOptions;
}): void {
  for (const reaction of input.reactions) {
    if (reaction.kind === 'unsubscribe-conversation') {
      input.options.enqueueQueuedReaction(async () => {
        await input.options.unsubscribeConversationEvents(reaction.sessionId);
      }, reaction.label);
      continue;
    }
    input.options.enqueueQueuedReaction(async () => {
      await input.options.activateConversation(reaction.sessionId);
    }, reaction.label);
  }
}
