import { parseMuxInputChunk } from '../dual-pane-core.ts';
import type { UiModalOverlay } from '../../../packages/harness-ui/src/kit.ts';
import { isMotionMouseCode, isWheelMouseCode } from './selection.ts';

interface DismissModalOnOutsideClickOptions {
  input: Buffer;
  inputRemainder: string;
  dismiss: () => void;
  buildCurrentModalOverlay: () => UiModalOverlay | null;
  onInsidePointerPress?: (col: number, row: number) => boolean;
  isOverlayHit: (overlay: UiModalOverlay, col: number, row: number) => boolean;
}

interface DismissModalOnOutsideClickResult {
  handled: boolean;
  inputRemainder: string;
}

export function dismissModalOnOutsideClick(
  options: DismissModalOnOutsideClickOptions,
): DismissModalOnOutsideClickResult {
  const { input, dismiss, buildCurrentModalOverlay, onInsidePointerPress, isOverlayHit } = options;
  if (!input.includes(0x1b)) {
    return {
      handled: false,
      inputRemainder: options.inputRemainder,
    };
  }
  const parsed = parseMuxInputChunk(options.inputRemainder, input);
  const modalOverlay = buildCurrentModalOverlay();
  if (modalOverlay === null) {
    return {
      handled: true,
      inputRemainder: parsed.remainder,
    };
  }
  for (const token of parsed.tokens) {
    if (token.kind !== 'mouse') {
      continue;
    }
    const pointerPress =
      token.event.final === 'M' &&
      !isWheelMouseCode(token.event.code) &&
      !isMotionMouseCode(token.event.code);
    if (!pointerPress) {
      continue;
    }
    if (!isOverlayHit(modalOverlay, token.event.col, token.event.row)) {
      dismiss();
      return {
        handled: true,
        inputRemainder: parsed.remainder,
      };
    }
    if (onInsidePointerPress?.(token.event.col, token.event.row) === true) {
      return {
        handled: true,
        inputRemainder: parsed.remainder,
      };
    }
  }
  return {
    handled: true,
    inputRemainder: parsed.remainder,
  };
}
