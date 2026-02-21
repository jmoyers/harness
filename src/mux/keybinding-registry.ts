type KeybindingScreen = 'global' | 'home';

interface KeybindingRegistryEntry {
  readonly actionId: string;
  readonly screen: KeybindingScreen;
  readonly header: string;
  readonly title: string;
  readonly description: string;
  readonly defaultBindings: readonly string[];
}

export const MUX_GLOBAL_SHORTCUT_ACTION_ORDER = [
  'mux.app.quit',
  'mux.app.interrupt-all',
  'mux.command-menu.toggle',
  'mux.debug-bar.toggle',
  'mux.gateway.profile.toggle',
  'mux.gateway.status-timeline.toggle',
  'mux.gateway.render-trace.toggle',
  'mux.conversation.new',
  'mux.conversation.critique.open-or-create',
  'mux.conversation.next',
  'mux.conversation.previous',
  'mux.conversation.titles.refresh-all',
  'mux.conversation.interrupt',
  'mux.conversation.archive',
  'mux.conversation.takeover',
  'mux.conversation.delete',
  'mux.directory.add',
  'mux.directory.close',
] as const;

export type MuxGlobalShortcutAction = (typeof MUX_GLOBAL_SHORTCUT_ACTION_ORDER)[number];

export const DEFAULT_MUX_SHORTCUT_BINDINGS_RAW: Readonly<
  Record<MuxGlobalShortcutAction, readonly string[]>
> = {
  'mux.app.quit': [],
  'mux.app.interrupt-all': ['ctrl+c'],
  'mux.command-menu.toggle': ['ctrl+p'],
  'mux.debug-bar.toggle': ['cmd+p'],
  'mux.gateway.profile.toggle': ['ctrl+shift+p'],
  'mux.gateway.status-timeline.toggle': ['alt+r'],
  'mux.gateway.render-trace.toggle': ['ctrl+]'],
  'mux.conversation.new': ['ctrl+t'],
  'mux.conversation.critique.open-or-create': ['ctrl+g'],
  'mux.conversation.next': ['ctrl+j'],
  'mux.conversation.previous': ['ctrl+k'],
  'mux.conversation.titles.refresh-all': ['ctrl+r'],
  'mux.conversation.interrupt': [],
  'mux.conversation.archive': [],
  'mux.conversation.takeover': ['ctrl+l'],
  'mux.conversation.delete': ['ctrl+x'],
  'mux.directory.add': ['ctrl+o'],
  'mux.directory.close': ['ctrl+w'],
};

export const TASK_SCREEN_KEYBINDING_ACTION_ORDER = [
  'mux.home.repo.dropdown.toggle',
  'mux.home.repo.next',
  'mux.home.repo.previous',
  'mux.home.task.submit',
  'mux.home.task.queue',
  'mux.home.task.newline',
  'mux.home.task.status.ready',
  'mux.home.task.status.draft',
  'mux.home.task.status.complete',
  'mux.home.task.reorder.up',
  'mux.home.task.reorder.down',
  'mux.home.editor.cursor.left',
  'mux.home.editor.cursor.right',
  'mux.home.editor.cursor.up',
  'mux.home.editor.cursor.down',
  'mux.home.editor.line.start',
  'mux.home.editor.line.end',
  'mux.home.editor.word.left',
  'mux.home.editor.word.right',
  'mux.home.editor.delete.backward',
  'mux.home.editor.delete.forward',
  'mux.home.editor.delete.word.backward',
  'mux.home.editor.delete.line.start',
  'mux.home.editor.delete.line.end',
] as const;

export type TaskScreenKeybindingAction = (typeof TASK_SCREEN_KEYBINDING_ACTION_ORDER)[number];

export const DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW: Readonly<
  Record<TaskScreenKeybindingAction, readonly string[]>
> = {
  'mux.home.repo.dropdown.toggle': ['alt+g'],
  'mux.home.repo.next': ['ctrl+n'],
  'mux.home.repo.previous': ['ctrl+p'],
  'mux.home.task.submit': ['enter'],
  'mux.home.task.queue': ['tab'],
  'mux.home.task.newline': ['shift+enter'],
  'mux.home.task.status.ready': ['alt+r'],
  'mux.home.task.status.draft': ['alt+d'],
  'mux.home.task.status.complete': ['alt+c'],
  'mux.home.task.reorder.up': ['ctrl+up'],
  'mux.home.task.reorder.down': ['ctrl+down'],
  'mux.home.editor.cursor.left': ['left', 'ctrl+b'],
  'mux.home.editor.cursor.right': ['right', 'ctrl+f'],
  'mux.home.editor.cursor.up': ['up'],
  'mux.home.editor.cursor.down': ['down'],
  'mux.home.editor.line.start': ['ctrl+a', 'home'],
  'mux.home.editor.line.end': ['ctrl+e', 'end'],
  'mux.home.editor.word.left': ['alt+b'],
  'mux.home.editor.word.right': ['alt+f'],
  'mux.home.editor.delete.backward': ['backspace'],
  'mux.home.editor.delete.forward': ['delete'],
  'mux.home.editor.delete.word.backward': ['ctrl+w', 'alt+backspace'],
  'mux.home.editor.delete.line.start': ['ctrl+u'],
  'mux.home.editor.delete.line.end': ['ctrl+k'],
};

const GLOBAL_KEYBINDING_ENTRIES: readonly KeybindingRegistryEntry[] = [
  {
    actionId: 'mux.command-menu.toggle',
    screen: 'global',
    header: 'Global',
    title: 'Toggle command palette',
    description: 'Open or close the command palette.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.command-menu.toggle'],
  },
  {
    actionId: 'mux.app.interrupt-all',
    screen: 'global',
    header: 'Global',
    title: 'Quit harness',
    description: 'Request harness shutdown immediately.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.app.interrupt-all'],
  },
  {
    actionId: 'mux.app.quit',
    screen: 'global',
    header: 'Global',
    title: 'Modal dismiss',
    description: 'Dismiss active modal overlays.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.app.quit'],
  },
  {
    actionId: 'mux.debug-bar.toggle',
    screen: 'global',
    header: 'Global',
    title: 'Toggle debug bar',
    description: 'Show or hide the bottom debug bar.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.debug-bar.toggle'],
  },
  {
    actionId: 'mux.conversation.new',
    screen: 'global',
    header: 'Conversations',
    title: 'New thread',
    description: 'Start a new thread in the active project.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.new'],
  },
  {
    actionId: 'mux.conversation.critique.open-or-create',
    screen: 'global',
    header: 'Conversations',
    title: 'Open or create critique thread',
    description: 'Jump to the critique thread for the active project.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.critique.open-or-create'],
  },
  {
    actionId: 'mux.conversation.next',
    screen: 'global',
    header: 'Conversations',
    title: 'Next left-nav item',
    description: 'Cycle selection forward in left navigation.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.next'],
  },
  {
    actionId: 'mux.conversation.previous',
    screen: 'global',
    header: 'Conversations',
    title: 'Previous left-nav item',
    description: 'Cycle selection backward in left navigation.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.previous'],
  },
  {
    actionId: 'mux.conversation.titles.refresh-all',
    screen: 'global',
    header: 'Conversations',
    title: 'Refresh thread titles',
    description: 'Recompute suggested titles for eligible threads.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.titles.refresh-all'],
  },
  {
    actionId: 'mux.conversation.interrupt',
    screen: 'global',
    header: 'Conversations',
    title: 'Interrupt active thread',
    description: 'Send interrupt signal to the active thread.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.interrupt'],
  },
  {
    actionId: 'mux.conversation.archive',
    screen: 'global',
    header: 'Conversations',
    title: 'Archive active thread',
    description: 'Archive the currently active thread.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.archive'],
  },
  {
    actionId: 'mux.conversation.takeover',
    screen: 'global',
    header: 'Conversations',
    title: 'Take over active thread',
    description: 'Take control of the active thread.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.takeover'],
  },
  {
    actionId: 'mux.conversation.delete',
    screen: 'global',
    header: 'Conversations',
    title: 'Archive active thread (alt action)',
    description: 'Archive the currently active thread.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.conversation.delete'],
  },
  {
    actionId: 'mux.directory.add',
    screen: 'global',
    header: 'Projects',
    title: 'Add project',
    description: 'Open add-project prompt.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.directory.add'],
  },
  {
    actionId: 'mux.directory.close',
    screen: 'global',
    header: 'Projects',
    title: 'Close project',
    description: 'Archive the selected project.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.directory.close'],
  },
  {
    actionId: 'mux.gateway.profile.toggle',
    screen: 'global',
    header: 'Diagnostics',
    title: 'Toggle profiler',
    description: 'Start or stop gateway profiling.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.profile.toggle'],
  },
  {
    actionId: 'mux.gateway.status-timeline.toggle',
    screen: 'global',
    header: 'Diagnostics',
    title: 'Toggle status timeline logging',
    description: 'Start or stop status timeline capture.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.status-timeline.toggle'],
  },
  {
    actionId: 'mux.gateway.render-trace.toggle',
    screen: 'global',
    header: 'Diagnostics',
    title: 'Toggle render trace logging',
    description: 'Start or stop focused render trace capture.',
    defaultBindings: DEFAULT_MUX_SHORTCUT_BINDINGS_RAW['mux.gateway.render-trace.toggle'],
  },
] as const;

const HOME_KEYBINDING_ENTRIES: readonly KeybindingRegistryEntry[] =
  TASK_SCREEN_KEYBINDING_ACTION_ORDER.map((actionId) => ({
    actionId,
    screen: 'home',
    header: 'Home / Tasks',
    title: actionId.replace(/^mux\.home\./u, '').replace(/\./gu, ' '),
    description: 'Task pane action.',
    defaultBindings: DEFAULT_TASK_SCREEN_KEYBINDINGS_RAW[actionId],
  }));

export const KEYBINDING_REGISTRY_ENTRIES: readonly KeybindingRegistryEntry[] = [
  ...GLOBAL_KEYBINDING_ENTRIES,
  ...HOME_KEYBINDING_ENTRIES,
];
