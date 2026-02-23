export function enterAlternateScreen(write: (data: string) => void): void {
  write('\x1b[?1049h');
}

export function exitAlternateScreen(write: (data: string) => void): void {
  write('\x1b[?1049l');
}

export function enableMouse(write: (data: string) => void): void {
  write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
}

export function disableMouse(write: (data: string) => void): void {
  write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
}

export function hideCursor(write: (data: string) => void): void {
  write('\x1b[?25l');
}

export function showCursor(write: (data: string) => void): void {
  write('\x1b[?25h');
}

export function clearScreen(write: (data: string) => void): void {
  write('\x1b[2J\x1b[H');
}

export interface TerminalState {
  alternateScreen: boolean;
  mouse: boolean;
  rawMode: boolean;
}

export function setupTerminal(
  write: (data: string) => void,
  stdin: { setRawMode?: (mode: boolean) => void; ref?: () => void },
  options: { alternateScreen: boolean; mouse: boolean },
): TerminalState {
  const state: TerminalState = {
    alternateScreen: options.alternateScreen,
    mouse: options.mouse,
    rawMode: false,
  };

  if (typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true);
    state.rawMode = true;
  }

  if (options.alternateScreen) enterAlternateScreen(write);
  if (options.mouse) enableMouse(write);
  hideCursor(write);

  return state;
}

export function restoreTerminal(
  write: (data: string) => void,
  stdin: { setRawMode?: (mode: boolean) => void; unref?: () => void },
  state: TerminalState,
): void {
  showCursor(write);
  if (state.mouse) disableMouse(write);
  if (state.alternateScreen) exitAlternateScreen(write);

  if (state.rawMode && typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(false);
  }
}
