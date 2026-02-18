import { ConversationInputForwarder } from '../ui/conversation-input-forwarder.ts';
import { InputPreflight } from '../ui/input-preflight.ts';

type InputPreflightOptions = ConstructorParameters<typeof InputPreflight>[0];
type ConversationInputForwarderOptions = ConstructorParameters<
  typeof ConversationInputForwarder
>[0];

interface RuntimeInputPipelineOptions {
  readonly preflight: InputPreflightOptions;
  readonly forwarder: ConversationInputForwarderOptions;
}

interface RuntimeInputPipelineDependencies {
  readonly createInputPreflight?: (
    options: InputPreflightOptions,
  ) => Pick<InputPreflight, 'nextInput'>;
  readonly createConversationInputForwarder?: (
    options: ConversationInputForwarderOptions,
  ) => Pick<ConversationInputForwarder, 'handleInput'>;
}

export class RuntimeInputPipeline {
  private readonly inputPreflight: Pick<InputPreflight, 'nextInput'>;
  private readonly conversationInputForwarder: Pick<ConversationInputForwarder, 'handleInput'>;

  constructor(
    options: RuntimeInputPipelineOptions,
    dependencies: RuntimeInputPipelineDependencies = {},
  ) {
    const createInputPreflight =
      dependencies.createInputPreflight ??
      ((preflightOptions: InputPreflightOptions) => new InputPreflight(preflightOptions));
    const createConversationInputForwarder =
      dependencies.createConversationInputForwarder ??
      ((forwarderOptions: ConversationInputForwarderOptions) =>
        new ConversationInputForwarder(forwarderOptions));

    this.inputPreflight = createInputPreflight(options.preflight);
    this.conversationInputForwarder = createConversationInputForwarder(options.forwarder);
  }

  handleInput(input: Buffer): void {
    const sanitized = this.inputPreflight.nextInput(input);
    if (sanitized === null) {
      return;
    }
    this.conversationInputForwarder.handleInput(sanitized);
  }
}
