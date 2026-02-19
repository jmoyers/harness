import {
  COMMAND_MENU_MAX_RESULTS,
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

const COMMAND_MENU_BODY_ROW_OFFSET = 2;
const COMMAND_MENU_ACTION_ROW_START = 2;
const THEME_PICKER_SCOPE = 'theme-select';

function resolveCommandMenuActionIdByRow(
  menu: CommandMenuState,
  actions: readonly CommandMenuActionDescriptor[],
  overlayTopRowZeroBased: number,
  rowOneBased: number,
): string | null {
  const matches = resolveCommandMenuMatches(actions, menu.query, null);
  if (matches.length === 0) {
    return null;
  }
  const selectedIndex = clampCommandMenuState(menu, matches.length).selectedIndex;
  const pageStart = Math.floor(selectedIndex / COMMAND_MENU_MAX_RESULTS) * COMMAND_MENU_MAX_RESULTS;
  const visibleMatches = matches.slice(pageStart, pageStart + COMMAND_MENU_MAX_RESULTS);
  const actionStartBodyLine = COMMAND_MENU_ACTION_ROW_START;
  const clickedBodyLine = rowOneBased - 1 - (overlayTopRowZeroBased + COMMAND_MENU_BODY_ROW_OFFSET);
  if (clickedBodyLine < actionStartBodyLine) {
    return null;
  }
  const visibleIndex = clickedBodyLine - actionStartBodyLine;
  if (visibleIndex < 0 || visibleIndex >= visibleMatches.length) {
    return null;
  }
  return visibleMatches[visibleIndex]?.action.id ?? null;
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
      (_col, row) => {
        const overlay = buildCommandMenuModalOverlay();
        if (overlay === null) {
          return false;
        }
        const selectedActionId = resolveCommandMenuActionIdByRow(
          menu,
          resolveActions(),
          overlay.top,
          row,
        );
        if (selectedActionId === null) {
          return false;
        }
        if (menu.scope === THEME_PICKER_SCOPE) {
          executeAction(selectedActionId);
          setMenu(null);
        } else {
          setMenu(null);
          executeAction(selectedActionId);
        }
        markDirty();
        return true;
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
    if (menu.scope === THEME_PICKER_SCOPE) {
      if (selected !== undefined) {
        executeAction(selected.action.id);
      }
      setMenu(null);
    } else {
      setMenu(null);
      if (selected !== undefined) {
        executeAction(selected.action.id);
      }
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
