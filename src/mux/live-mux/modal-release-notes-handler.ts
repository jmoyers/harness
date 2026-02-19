import type { ReleaseNotesPrompt } from './release-notes.ts';
import { RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET } from './modal-overlays.ts';

interface HandleReleaseNotesModalInputOptions {
  readonly input: Buffer;
  readonly prompt: ReleaseNotesPrompt | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildReleaseNotesModalOverlay: () => { top: number } | null;
  readonly setPrompt: (next: ReleaseNotesPrompt | null) => void;
  readonly markDirty: () => void;
  readonly onDismiss: (latestTag: string) => void;
  readonly onNeverShowAgain: (latestTag: string) => void;
  readonly onOpenLatest: (prompt: ReleaseNotesPrompt) => void;
  readonly onUpdate: () => void;
}

function byteMatches(inputByte: number, lower: string): boolean {
  const ascii = lower.charCodeAt(0);
  return inputByte === ascii || inputByte === ascii - 32;
}

export function handleReleaseNotesModalInput(
  options: HandleReleaseNotesModalInputOptions,
): boolean {
  const {
    input,
    prompt,
    isQuitShortcut,
    dismissOnOutsideClick,
    buildReleaseNotesModalOverlay,
    setPrompt,
    markDirty,
    onDismiss,
    onNeverShowAgain,
    onOpenLatest,
    onUpdate,
  } = options;
  if (prompt === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    setPrompt(null);
    onDismiss(prompt.latestTag);
    markDirty();
    return true;
  }
  if (
    input.includes(0x3c) &&
    dismissOnOutsideClick(
      input,
      () => {
        setPrompt(null);
        onDismiss(prompt.latestTag);
        markDirty();
      },
      (_col, row) => {
        const overlay = buildReleaseNotesModalOverlay();
        if (overlay === null) {
          return false;
        }
        if (row - 1 !== overlay.top + RELEASE_NOTES_UPDATE_ACTION_ROW_OFFSET) {
          return false;
        }
        setPrompt(null);
        onDismiss(prompt.latestTag);
        onUpdate();
        markDirty();
        return true;
      },
    )
  ) {
    return true;
  }

  for (const byte of input) {
    if (byte === 0x0d || byte === 0x0a) {
      setPrompt(null);
      onDismiss(prompt.latestTag);
      markDirty();
      return true;
    }
    if (byteMatches(byte, 'n')) {
      setPrompt(null);
      onNeverShowAgain(prompt.latestTag);
      markDirty();
      return true;
    }
    if (byteMatches(byte, 'u')) {
      setPrompt(null);
      onDismiss(prompt.latestTag);
      onUpdate();
      markDirty();
      return true;
    }
    if (byteMatches(byte, 'o')) {
      onOpenLatest(prompt);
      markDirty();
      return true;
    }
  }

  return true;
}
