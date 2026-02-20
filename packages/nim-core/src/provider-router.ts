import type { NimModelRef, NimProvider, NimProviderId, NimToolDefinition } from './contracts.ts';

export type ParsedNimModelRef = {
  readonly providerId: NimProviderId;
  readonly providerModelId: string;
};

export type NimProviderTurnInput = {
  readonly modelRef: NimModelRef;
  readonly providerModelId: string;
  readonly input: string;
  readonly tools: readonly NimToolDefinition[];
  readonly abortSignal?: AbortSignal;
};

export type NimProviderTurnEvent =
  | {
      readonly type: 'provider.thinking.started';
    }
  | {
      readonly type: 'provider.thinking.delta';
      readonly text: string;
    }
  | {
      readonly type: 'provider.thinking.completed';
    }
  | {
      readonly type: 'tool.call.started';
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: 'tool.call.arguments.delta';
      readonly toolCallId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'tool.call.completed';
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: 'tool.call.failed';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly error: string;
    }
  | {
      readonly type: 'tool.result.emitted';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly output?: unknown;
    }
  | {
      readonly type: 'assistant.output.delta';
      readonly text: string;
    }
  | {
      readonly type: 'assistant.output.completed';
    }
  | {
      readonly type: 'provider.turn.finished';
      readonly finishReason: string;
    }
  | {
      readonly type: 'provider.turn.error';
      readonly message: string;
    };

export interface NimProviderDriver {
  readonly providerId: NimProviderId;
  runTurn(input: NimProviderTurnInput): AsyncIterable<NimProviderTurnEvent>;
}

export function parseNimModelRef(modelRef: NimModelRef): ParsedNimModelRef {
  const slashIndex = modelRef.indexOf('/');
  if (slashIndex <= 0 || slashIndex === modelRef.length - 1) {
    throw new Error(`invalid model ref: ${modelRef}`);
  }

  const providerId = modelRef.slice(0, slashIndex);
  const providerModelId = modelRef.slice(slashIndex + 1);
  if (providerId.trim().length === 0 || providerModelId.trim().length === 0) {
    throw new Error(`invalid model ref: ${modelRef}`);
  }

  return {
    providerId,
    providerModelId,
  };
}

export type ResolvedNimProvider = {
  readonly provider: NimProvider;
  readonly parsedModel: ParsedNimModelRef;
  readonly driver?: NimProviderDriver;
};

export class NimProviderRouter {
  private providers = new Map<NimProviderId, NimProvider>();
  private drivers = new Map<NimProviderId, NimProviderDriver>();

  public registerProvider(provider: NimProvider): void {
    this.providers.set(provider.id, provider);
  }

  public registerDriver(driver: NimProviderDriver): void {
    this.drivers.set(driver.providerId, driver);
  }

  public resolveModel(modelRef: NimModelRef): ResolvedNimProvider {
    const parsedModel = parseNimModelRef(modelRef);
    const provider = this.providers.get(parsedModel.providerId);
    if (provider === undefined) {
      throw new Error(`provider not registered: ${parsedModel.providerId}`);
    }

    if (!provider.models.includes(modelRef)) {
      throw new Error(`model not registered for provider ${provider.id}: ${modelRef}`);
    }

    const driver = this.drivers.get(parsedModel.providerId);
    return {
      provider,
      parsedModel,
      ...(driver !== undefined ? { driver } : {}),
    };
  }
}
