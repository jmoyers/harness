interface ModalDismissResult {
  readonly handled: boolean;
  readonly inputRemainder: string;
}

interface ModalDismissManager {
  dismissOnOutsideClick(input: {
    readonly input: Buffer;
    readonly inputRemainder: string;
    readonly layoutCols: number;
    readonly viewportRows: number;
    readonly dismiss: () => void;
    readonly onInsidePointerPress?: (col: number, row: number) => boolean;
  }): ModalDismissResult;
}

export interface DismissModalOnOutsideClickInput {
  readonly modalManager: ModalDismissManager;
  readonly layoutCols: number;
  readonly viewportRows: number;
  readonly input: Buffer;
  readonly dismiss: () => void;
  readonly onInsidePointerPress?: (col: number, row: number) => boolean;
}

export interface TuiModalInputRemainderState {
  getInputRemainder(): string;
  setInputRemainder(next: string): void;
  dismissModalOnOutsideClick(input: DismissModalOnOutsideClickInput): boolean;
}

export function createTuiModalInputRemainderState(
  initialInputRemainder = '',
): TuiModalInputRemainderState {
  let inputRemainder = initialInputRemainder;
  return {
    getInputRemainder: (): string => inputRemainder,
    setInputRemainder: (next: string): void => {
      inputRemainder = next;
    },
    dismissModalOnOutsideClick: (input: DismissModalOnOutsideClickInput): boolean => {
      const result = input.modalManager.dismissOnOutsideClick({
        input: input.input,
        inputRemainder,
        layoutCols: input.layoutCols,
        viewportRows: input.viewportRows,
        dismiss: input.dismiss,
      ...(input.onInsidePointerPress === undefined
        ? {}
        : {
            onInsidePointerPress: input.onInsidePointerPress,
          }),
      });
      inputRemainder = result.inputRemainder;
      return result.handled;
    },
  };
}

export interface RouteTuiModalInputOptions {
  readonly input: Buffer;
  readonly routeReleaseNotesModalInput: (input: Buffer) => boolean;
  readonly routeModalInput: (input: Buffer) => boolean;
}

export function routeTuiModalInput(options: RouteTuiModalInputOptions): boolean {
  if (options.routeReleaseNotesModalInput(options.input)) {
    return true;
  }
  return options.routeModalInput(options.input);
}
