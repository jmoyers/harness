import {
  clampCommandMenuState,
  reduceCommandMenuInput,
  resolveCommandMenuMatches,
  type CommandMenuActionDescriptor,
  type CommandMenuState,
} from './command-menu.ts';

interface HandleCommandMenuInputOptions {
  readonly input: Buffer;
  readonly menu: CommandMenuState | null;
  readonly isQuitShortcut: (input: Buffer) => boolean;
  readonly isToggleShortcut: (input: Buffer) => boolean;
  readonly dismissOnOutsideClick: (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean,
  ) => boolean;
  readonly buildCommandMenuModalOverlay: () => { top: number } | null;
  readonly resolveActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeAction: (actionId: string) => void;
  readonly setMenu: (next: CommandMenuState | null) => void;
  readonly markDirty: () => void;
}

export function handleCommandMenuInput(options: HandleCommandMenuInputOptions): boolean {
  const {
    input,
    menu,
    isQuitShortcut,
    isToggleShortcut,
    dismissOnOutsideClick,
    buildCommandMenuModalOverlay,
    resolveActions,
    executeAction,
    setMenu,
    markDirty,
  } = options;
  if (menu === null) {
    return false;
  }
  if (input.length === 1 && input[0] === 0x03) {
    return false;
  }
  if (isQuitShortcut(input)) {
    setMenu(null);
    markDirty();
    return true;
  }
  if (isToggleShortcut(input)) {
    setMenu(null);
    markDirty();
    return true;
  }
  const maybeMouseSequence = input.includes(0x3c);
  if (
    maybeMouseSequence &&
    dismissOnOutsideClick(
      input,
      () => {
        setMenu(null);
        markDirty();
      },
      (_col, _row) => {
        return buildCommandMenuModalOverlay() !== null;
      },
    )
  ) {
    return true;
  }

  const currentMatches = resolveCommandMenuMatches(resolveActions(), menu.query, null);
  const reduction = reduceCommandMenuInput(menu, input, currentMatches.length);
  if (reduction.submit) {
    const clamped = clampCommandMenuState(menu, currentMatches.length);
    const selected = currentMatches[clamped.selectedIndex];
    setMenu(null);
    if (selected !== undefined) {
      executeAction(selected.action.id);
    }
    markDirty();
    return true;
  }

  const nextMatches = resolveCommandMenuMatches(resolveActions(), reduction.nextState.query, null);
  const nextState = clampCommandMenuState(reduction.nextState, nextMatches.length);
  if (nextState.query !== menu.query || nextState.selectedIndex !== menu.selectedIndex) {
    setMenu(nextState);
    markDirty();
  }
  return true;
}
