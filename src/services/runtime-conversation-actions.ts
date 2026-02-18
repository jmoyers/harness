import {
  createAndActivateConversationInDirectory as createAndActivateConversationInDirectoryFn,
  openOrCreateCritiqueConversationInDirectory as openOrCreateCritiqueConversationInDirectoryFn,
  takeoverConversation as takeoverConversationFn,
} from '../mux/live-mux/actions-conversation.ts';

interface RuntimeConversationRecord {
  readonly directoryId: string | null;
  readonly agentType: string;
}

interface RuntimeConversationActionService<TControllerRecord> {
  createConversation(input: {
    conversationId: string;
    directoryId: string;
    title: string;
    agentType: string;
    adapterState: Record<string, unknown>;
  }): Promise<unknown>;
  claimSession(input: {
    sessionId: string;
    controllerId: string;
    controllerType: string;
    controllerLabel: string;
    reason: string;
    takeover: boolean;
  }): Promise<TControllerRecord | null>;
}

export interface RuntimeConversationActionsOptions<TControllerRecord> {
  readonly controlPlaneService: RuntimeConversationActionService<TControllerRecord>;
  readonly createConversationId: () => string;
  readonly ensureConversation: (
    sessionId: string,
    seed: {
      directoryId: string;
      title: string;
      agentType: string;
      adapterState: Record<string, unknown>;
    },
  ) => void;
  readonly noteGitActivity: (directoryId: string) => void;
  readonly startConversation: (sessionId: string) => Promise<unknown>;
  readonly activateConversation: (sessionId: string) => Promise<unknown>;
  readonly orderedConversationIds: () => readonly string[];
  readonly conversationById: (sessionId: string) => RuntimeConversationRecord | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly applyController: (sessionId: string, controller: TControllerRecord) => void;
  readonly setLastEventNow: (sessionId: string) => void;
  readonly muxControllerId: string;
  readonly muxControllerLabel: string;
  readonly markDirty: () => void;
}

export class RuntimeConversationActions<TControllerRecord> {
  constructor(private readonly options: RuntimeConversationActionsOptions<TControllerRecord>) {}

  async createAndActivateConversationInDirectory(
    directoryId: string,
    agentType: string,
  ): Promise<void> {
    await createAndActivateConversationInDirectoryFn({
      directoryId,
      agentType,
      createConversationId: this.options.createConversationId,
      createConversationRecord: async (sessionId, targetDirectoryId, targetAgentType) => {
        await this.options.controlPlaneService.createConversation({
          conversationId: sessionId,
          directoryId: targetDirectoryId,
          title: '',
          agentType: String(targetAgentType),
          adapterState: {},
        });
      },
      ensureConversation: this.options.ensureConversation,
      noteGitActivity: this.options.noteGitActivity,
      startConversation: this.options.startConversation,
      activateConversation: this.options.activateConversation,
    });
  }

  async openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void> {
    await openOrCreateCritiqueConversationInDirectoryFn({
      directoryId,
      orderedConversationIds: this.options.orderedConversationIds,
      conversationById: this.options.conversationById,
      activateConversation: this.options.activateConversation,
      createAndActivateCritiqueConversationInDirectory: async (targetDirectoryId) => {
        await this.createAndActivateConversationInDirectory(targetDirectoryId, 'critique');
      },
    });
  }

  async takeoverConversation(sessionId: string): Promise<void> {
    await takeoverConversationFn({
      sessionId,
      conversationsHas: this.options.conversationsHas,
      claimSession: async (targetSessionId) => {
        return await this.options.controlPlaneService.claimSession({
          sessionId: targetSessionId,
          controllerId: this.options.muxControllerId,
          controllerType: 'human',
          controllerLabel: this.options.muxControllerLabel,
          reason: 'human takeover',
          takeover: true,
        });
      },
      applyController: this.options.applyController,
      setLastEventNow: this.options.setLastEventNow,
      markDirty: this.options.markDirty,
    });
  }
}
