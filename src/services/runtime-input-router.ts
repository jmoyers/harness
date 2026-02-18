import { RuntimeMainPaneInput } from './runtime-main-pane-input.ts';
import { RuntimeModalInput } from './runtime-modal-input.ts';
import { RuntimeRailInput } from './runtime-rail-input.ts';

type RuntimeModalInputOptions = ConstructorParameters<typeof RuntimeModalInput>[0];
type RuntimeRailInputOptions = ConstructorParameters<typeof RuntimeRailInput>[0];
type RuntimeMainPaneInputOptions = ConstructorParameters<typeof RuntimeMainPaneInput>[0];
type RuntimeMainPaneInputWithoutLeftRail = Omit<
  RuntimeMainPaneInputOptions,
  'leftRailPointerInput'
>;

interface RuntimeInputRouterOptions {
  readonly modal: RuntimeModalInputOptions;
  readonly rail: RuntimeRailInputOptions;
  readonly mainPane: RuntimeMainPaneInputWithoutLeftRail;
}

export class RuntimeInputRouter {
  private readonly modalInput: RuntimeModalInput;
  private readonly railInput: RuntimeRailInput;
  private readonly mainPaneInput: RuntimeMainPaneInput;

  constructor(options: RuntimeInputRouterOptions) {
    this.modalInput = new RuntimeModalInput(options.modal);
    this.railInput = new RuntimeRailInput(options.rail);
    this.mainPaneInput = new RuntimeMainPaneInput({
      ...options.mainPane,
      leftRailPointerInput: this.railInput,
    });
  }

  routeModalInput(input: Buffer): boolean {
    return this.modalInput.routeModalInput(input);
  }

  handleRepositoryFoldInput(input: Buffer): boolean {
    return this.railInput.handleRepositoryFoldInput(input);
  }

  handleGlobalShortcutInput(input: Buffer): boolean {
    return this.railInput.handleGlobalShortcutInput(input);
  }

  inputTokenRouter(): Pick<RuntimeMainPaneInput, 'routeTokens'> {
    return this.mainPaneInput;
  }
}
