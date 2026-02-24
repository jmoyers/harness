import type { CommandAction } from '../../../harness-ui/src/widgets/command-palette.ts';

export const NIM_COMMANDS: CommandAction[] = [
  { id: 'new-session', title: 'New session', keywords: ['fresh', 'conversation'] },
  { id: 'session-list', title: 'Session list', keywords: ['history', 'threads'] },
  { id: 'mode-build', title: 'Switch to Build mode', keywords: ['agent', 'build'] },
  { id: 'mode-plan', title: 'Switch to Plan mode', keywords: ['agent', 'plan'] },
  { id: 'model', title: 'Switch model', keywords: ['provider', 'model'] },
  { id: 'toggle-sidebar', title: 'Toggle sidebar', keywords: ['panel', 'context'] },
  { id: 'toggle-thinking', title: 'Toggle thinking details', keywords: ['reasoning'] },
  { id: 'help', title: 'Help', bindingHint: 'ctrl+h' },
];
