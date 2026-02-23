export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  readonly text: string;
  readonly textMuted: string;
  readonly textAccent: string;
  readonly background: string;
  readonly backgroundPanel: string;
  readonly backgroundOverlay: string;
  readonly border: string;
  readonly borderFocused: string;
  readonly primary: string;
  readonly secondary: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly selection: string;
  readonly cursor: string;
}

export interface ThemeInput {
  readonly text: string;
  readonly placeholder: string;
  readonly background: string;
  readonly focusedBackground: string;
  readonly focusedBorder: string;
  readonly cursor: string;
}

export interface ThemeSelect {
  readonly text: string;
  readonly selectedText: string;
  readonly selectedBackground: string;
  readonly description: string;
  readonly selectedDescription: string;
}

export interface ThemeModal {
  readonly frame: string;
  readonly title: string;
  readonly body: string;
  readonly footer: string;
  readonly background: string;
}

export interface ThemeTerminal {
  readonly palette: readonly string[];
  readonly foreground: string;
  readonly background: string;
  readonly cursor: string;
  readonly selection: string;
}

export interface ThemeDiff {
  readonly added: string;
  readonly removed: string;
  readonly context: string;
  readonly hunkHeader: string;
  readonly addedBg: string;
  readonly removedBg: string;
  readonly contextBg: string;
  readonly lineNumber: string;
  readonly highlightAdded: string;
  readonly highlightRemoved: string;
}

export interface ThemeMarkdown {
  readonly text: string;
  readonly heading: string;
  readonly link: string;
  readonly linkText: string;
  readonly code: string;
  readonly blockQuote: string;
  readonly emphasis: string;
  readonly strong: string;
  readonly horizontalRule: string;
  readonly listItem: string;
  readonly listEnumeration: string;
  readonly codeBlock: string;
}

export interface ThemeSyntax {
  readonly comment: string;
  readonly keyword: string;
  readonly function: string;
  readonly variable: string;
  readonly string: string;
  readonly number: string;
  readonly type: string;
  readonly operator: string;
  readonly punctuation: string;
}

export interface Theme {
  readonly mode: ThemeMode;
  readonly colors: ThemeColors;
  readonly input: ThemeInput;
  readonly select: ThemeSelect;
  readonly modal: ThemeModal;
  readonly terminal: ThemeTerminal;
  readonly diff: ThemeDiff;
  readonly markdown: ThemeMarkdown;
  readonly syntax: ThemeSyntax;
}
