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

export interface RuntimeConversationActions {
  createAndActivateConversationInDirectory(directoryId: string, agentType: string): Promise<void>;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
}

export function createRuntimeConversationActions<TControllerRecord>(
  options: RuntimeConversationActionsOptions<TControllerRecord>,
): RuntimeConversationActions {
  const createAndActivateConversationInDirectory = async (
    directoryId: string,
    agentType: string,
  ): Promise<void> => {
    await createAndActivateConversationInDirectoryFn({
      directoryId,
      agentType,
      createConversationId: options.createConversationId,
      createConversationRecord: async (sessionId, targetDirectoryId, targetAgentType) => {
        await options.controlPlaneService.createConversation({
          conversationId: sessionId,
          directoryId: targetDirectoryId,
          title: '',
          agentType: String(targetAgentType),
          adapterState: {},
        });
      },
      ensureConversation: options.ensureConversation,
      noteGitActivity: options.noteGitActivity,
      startConversation: options.startConversation,
      activateConversation: options.activateConversation,
    });
  };

  const openOrCreateCritiqueConversationInDirectory = async (directoryId: string): Promise<void> => {
    await openOrCreateCritiqueConversationInDirectoryFn({
      directoryId,
      orderedConversationIds: options.orderedConversationIds,
      conversationById: options.conversationById,
      activateConversation: options.activateConversation,
      createAndActivateCritiqueConversationInDirectory: async (targetDirectoryId) => {
        await createAndActivateConversationInDirectory(targetDirectoryId, 'critique');
      },
    });
  };

  const takeoverConversation = async (sessionId: string): Promise<void> => {
    await takeoverConversationFn({
      sessionId,
      conversationsHas: options.conversationsHas,
      claimSession: async (targetSessionId) => {
        return await options.controlPlaneService.claimSession({
          sessionId: targetSessionId,
          controllerId: options.muxControllerId,
          controllerType: 'human',
          controllerLabel: options.muxControllerLabel,
          reason: 'human takeover',
          takeover: true,
        });
      },
      applyController: options.applyController,
      setLastEventNow: options.setLastEventNow,
      markDirty: options.markDirty,
    });
  };

  return {
    createAndActivateConversationInDirectory,
    openOrCreateCritiqueConversationInDirectory,
    takeoverConversation,
  };
}
