import {
  MUX_GLOBAL_SHORTCUT_ACTION_ORDER,
  TASK_SCREEN_KEYBINDING_ACTION_ORDER,
  type MuxGlobalShortcutAction,
  type TaskScreenKeybindingAction,
} from './keybinding-registry.ts';
import type { ResolvedMuxShortcutBindings } from './input-shortcuts.ts';
import type { ResolvedTaskScreenKeybindings } from './task-screen-keybindings.ts';

export const SHORTCUT_CATALOG_ACTION_ID_PREFIX = 'shortcut.binding.';
const SHOW_KEYBINDINGS_ACTION_ID = 'shortcuts.show';

interface KeybindingActionMetadata {
  readonly title: string;
  readonly screenLabel: string;
  readonly sectionLabel: string;
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
}

interface KeybindingCatalogEntry {
  readonly id: string;
  readonly actionId: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly detail: string;
  readonly screenLabel: string;
  readonly sectionLabel: string;
  readonly bindingHint: string;
}

export const SHOW_KEYBINDINGS_COMMAND_ACTION = {
  id: SHOW_KEYBINDINGS_ACTION_ID,
  title: 'Show Keybindings',
  aliases: ['shortcuts', 'keybinds', 'keybindings'],
  keywords: ['shortcut', 'shortcuts', 'keybind', 'keybinds', 'keybindings', 'hotkeys'],
  detail: 'browse active keyboard shortcuts',
} as const;

const GLOBAL_ACTION_METADATA: Readonly<Record<MuxGlobalShortcutAction, KeybindingActionMetadata>> =
  {
    'mux.app.quit': {
      title: 'Quit',
      screenLabel: 'Global',
      sectionLabel: 'App',
    },
    'mux.app.interrupt-all': {
      title: 'Interrupt All',
      screenLabel: 'Global',
      sectionLabel: 'App',
    },
    'mux.command-menu.toggle': {
      title: 'Toggle Command Menu',
      screenLabel: 'Global',
      sectionLabel: 'Navigation',
      aliases: ['command palette'],
    },
    'mux.debug-bar.toggle': {
      title: 'Toggle Debug Bar',
      screenLabel: 'Global',
      sectionLabel: 'Debug',
    },
    'mux.gateway.profile.toggle': {
      title: 'Toggle Gateway Profile',
      screenLabel: 'Global',
      sectionLabel: 'Gateway',
    },
    'mux.gateway.status-timeline.toggle': {
      title: 'Toggle Status Timeline',
      screenLabel: 'Global',
      sectionLabel: 'Gateway',
    },
    'mux.gateway.render-trace.toggle': {
      title: 'Toggle Render Trace',
      screenLabel: 'Global',
      sectionLabel: 'Gateway',
    },
    'mux.conversation.new': {
      title: 'New Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.critique.open-or-create': {
      title: 'Open/Create Critique Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.next': {
      title: 'Next Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.previous': {
      title: 'Previous Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.titles.refresh-all': {
      title: 'Refresh Thread Titles',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.interrupt': {
      title: 'Interrupt Active Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.archive': {
      title: 'Archive Active Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.takeover': {
      title: 'Take Over Active Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.conversation.delete': {
      title: 'Delete Active Thread',
      screenLabel: 'Global',
      sectionLabel: 'Conversations',
    },
    'mux.directory.add': {
      title: 'Add Project',
      screenLabel: 'Global',
      sectionLabel: 'Projects',
    },
    'mux.directory.close': {
      title: 'Close Active Project',
      screenLabel: 'Global',
      sectionLabel: 'Projects',
    },
  };

const TASK_ACTION_METADATA: Readonly<Record<TaskScreenKeybindingAction, KeybindingActionMetadata>> =
  {
    'mux.home.repo.dropdown.toggle': {
      title: 'Toggle Repository Picker',
      screenLabel: 'Home',
      sectionLabel: 'Repositories',
    },
    'mux.home.repo.next': {
      title: 'Next Repository',
      screenLabel: 'Home',
      sectionLabel: 'Repositories',
    },
    'mux.home.repo.previous': {
      title: 'Previous Repository',
      screenLabel: 'Home',
      sectionLabel: 'Repositories',
    },
    'mux.home.task.submit': {
      title: 'Submit Task as Ready',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.queue': {
      title: 'Queue Task as Draft',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.newline': {
      title: 'Insert Newline',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.task.status.ready': {
      title: 'Set Task Ready',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.status.draft': {
      title: 'Set Task Draft',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.status.complete': {
      title: 'Set Task Complete',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.reorder.up': {
      title: 'Move Task Up',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.task.reorder.down': {
      title: 'Move Task Down',
      screenLabel: 'Home',
      sectionLabel: 'Tasks',
    },
    'mux.home.editor.cursor.left': {
      title: 'Move Cursor Left',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.cursor.right': {
      title: 'Move Cursor Right',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.cursor.up': {
      title: 'Move Cursor Up',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.cursor.down': {
      title: 'Move Cursor Down',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.line.start': {
      title: 'Move to Line Start',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.line.end': {
      title: 'Move to Line End',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.word.left': {
      title: 'Move to Previous Word',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.word.right': {
      title: 'Move to Next Word',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.delete.backward': {
      title: 'Delete Backward',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.delete.forward': {
      title: 'Delete Forward',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.delete.word.backward': {
      title: 'Delete Previous Word',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.delete.line.start': {
      title: 'Delete to Line Start',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
    'mux.home.editor.delete.line.end': {
      title: 'Delete to Line End',
      screenLabel: 'Home',
      sectionLabel: 'Editor',
    },
  };

function bindingHint(bindings: readonly string[]): string {
  return bindings.length === 0 ? '(unbound)' : bindings.join(', ');
}

function uniqueLower(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function keywordsFromActionId(actionId: string): readonly string[] {
  return actionId
    .split('.')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part !== 'mux' && part !== 'home');
}

function toCatalogEntry(
  actionId: string,
  bindings: readonly string[],
  metadata: KeybindingActionMetadata,
): KeybindingCatalogEntry {
  const hint = bindingHint(bindings);
  const aliases = uniqueLower([
    actionId,
    metadata.title,
    metadata.sectionLabel,
    ...(metadata.aliases ?? []),
    ...bindings,
  ]);
  const keywords = uniqueLower([
    'shortcut',
    'keybinding',
    'keybind',
    metadata.screenLabel,
    metadata.sectionLabel,
    ...(metadata.keywords ?? []),
    ...keywordsFromActionId(actionId),
    ...bindings,
  ]);
  return {
    id: `${SHORTCUT_CATALOG_ACTION_ID_PREFIX}${actionId}`,
    actionId,
    title: metadata.title,
    aliases,
    keywords,
    detail: actionId,
    screenLabel: metadata.screenLabel,
    sectionLabel: metadata.sectionLabel,
    bindingHint: hint,
  };
}

export function buildKeybindingCatalogEntries(input: {
  readonly globalBindings: ResolvedMuxShortcutBindings;
  readonly taskScreenKeybindings: ResolvedTaskScreenKeybindings;
}): readonly KeybindingCatalogEntry[] {
  const global = MUX_GLOBAL_SHORTCUT_ACTION_ORDER.map((actionId) =>
    toCatalogEntry(
      actionId,
      input.globalBindings.rawByAction[actionId],
      GLOBAL_ACTION_METADATA[actionId],
    ),
  );
  const taskScreen = TASK_SCREEN_KEYBINDING_ACTION_ORDER.map((actionId) =>
    toCatalogEntry(
      actionId,
      input.taskScreenKeybindings.rawByAction[actionId],
      TASK_ACTION_METADATA[actionId],
    ),
  );
  return [...global, ...taskScreen];
}
