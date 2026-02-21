export interface InputPreflightOptions {
  readonly isShuttingDown: () => boolean;
  readonly routeModalInput: (input: Buffer) => boolean;
  readonly handleEscapeInput: (input: Buffer) => void;
  readonly onFocusIn: () => void;
  readonly onFocusOut: () => void;
  readonly handleRepositoryFoldInput: (input: Buffer) => boolean;
  readonly handleGlobalShortcutInput: (input: Buffer) => boolean;
  readonly handleTaskPaneShortcutInput: (input: Buffer) => boolean;
  readonly handleCopyShortcutInput: (input: Buffer) => boolean;
}

export interface InputPreflightStrategies {
  extractFocusEvents(input: Buffer): {
    readonly sanitized: Buffer;
    readonly focusInCount: number;
    readonly focusOutCount: number;
  };
}

export class InputPreflight {
  constructor(
    private readonly options: InputPreflightOptions,
    private readonly strategies: InputPreflightStrategies,
  ) {}

  nextInput(input: Buffer): Buffer | null {
    if (this.options.isShuttingDown()) {
      return null;
    }
    if (this.options.routeModalInput(input)) {
      return null;
    }

    if (input.length === 1 && input[0] === 0x1b) {
      this.options.handleEscapeInput(input);
      return null;
    }

    const focusExtraction = this.strategies.extractFocusEvents(input);
    if (focusExtraction.focusInCount > 0) {
      this.options.onFocusIn();
    }
    if (focusExtraction.focusOutCount > 0) {
      this.options.onFocusOut();
    }
    if (focusExtraction.sanitized.length === 0) {
      return null;
    }

    if (this.options.handleRepositoryFoldInput(focusExtraction.sanitized)) {
      return null;
    }
    if (this.options.handleGlobalShortcutInput(focusExtraction.sanitized)) {
      return null;
    }
    if (this.options.handleTaskPaneShortcutInput(focusExtraction.sanitized)) {
      return null;
    }
    if (this.options.handleCopyShortcutInput(focusExtraction.sanitized)) {
      return null;
    }

    return focusExtraction.sanitized;
  }
}
