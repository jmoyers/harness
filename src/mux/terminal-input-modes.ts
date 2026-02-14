const ENABLE_KEYBOARD_PROTOCOL = '\u001b[>1u';
const ENABLE_POINTER_AND_FOCUS_MODES = '\u001b[?1000h\u001b[?1002h\u001b[?1004h\u001b[?1006h';

// Keep disable broader than enable for robust cleanup from partially configured terminals.
const DISABLE_POINTER_AND_FOCUS_MODES =
  '\u001b[?2004l\u001b[?1006l\u001b[?1015l\u001b[?1005l\u001b[?1004l\u001b[?1003l\u001b[?1002l\u001b[?1000l';
const DISABLE_KEYBOARD_PROTOCOL = '\u001b[<u';

export const ENABLE_MUX_INPUT_MODES = `${ENABLE_KEYBOARD_PROTOCOL}${ENABLE_POINTER_AND_FOCUS_MODES}`;
export const DISABLE_MUX_INPUT_MODES = `${DISABLE_POINTER_AND_FOCUS_MODES}${DISABLE_KEYBOARD_PROTOCOL}`;

interface MuxInputModeManager {
  enable: () => void;
  restore: () => void;
  isEnabled: () => boolean;
}

export function createMuxInputModeManager(write: (sequence: string) => void): MuxInputModeManager {
  let enabled = false;

  return {
    enable: (): void => {
      if (enabled) {
        return;
      }
      write(ENABLE_MUX_INPUT_MODES);
      enabled = true;
    },
    restore: (): void => {
      write(DISABLE_MUX_INPUT_MODES);
      enabled = false;
    },
    isEnabled: (): boolean => enabled
  };
}
