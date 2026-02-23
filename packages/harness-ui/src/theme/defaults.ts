import type { Theme, ThemeMode } from './theme.ts';

const ANSI_16_DARK: readonly string[] = [
  '#1a1a2e',
  '#e74c3c',
  '#2ecc71',
  '#f1c40f',
  '#3498db',
  '#9b59b6',
  '#1abc9c',
  '#bdc3c7',
  '#7f8c8d',
  '#e74c3c',
  '#2ecc71',
  '#f1c40f',
  '#3498db',
  '#9b59b6',
  '#1abc9c',
  '#ecf0f1',
];

const ANSI_16_LIGHT: readonly string[] = [
  '#f8f9fa',
  '#c0392b',
  '#27ae60',
  '#f39c12',
  '#2980b9',
  '#8e44ad',
  '#16a085',
  '#2c3e50',
  '#95a5a6',
  '#e74c3c',
  '#2ecc71',
  '#f1c40f',
  '#3498db',
  '#9b59b6',
  '#1abc9c',
  '#1a1a2e',
];

export const DARK_THEME: Theme = {
  mode: 'dark',
  colors: {
    text: '#E2E8F0',
    textMuted: '#94A3B8',
    textAccent: '#38BDF8',
    background: '#0F172A',
    backgroundPanel: '#1E293B',
    backgroundOverlay: '#1E3A5F',
    border: '#475569',
    borderFocused: '#60A5FA',
    primary: '#3B82F6',
    secondary: '#6366F1',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    selection: '#1E3A5F',
    cursor: '#60A5FA',
  },
  input: {
    text: '#E2E8F0',
    placeholder: '#94A3B8',
    background: '#1E293B',
    focusedBackground: '#1a1a2e',
    focusedBorder: '#60A5FA',
    cursor: '#60A5FA',
  },
  select: {
    text: '#E2E8F0',
    selectedText: '#38BDF8',
    selectedBackground: '#1E3A5F',
    description: '#64748B',
    selectedDescription: '#94A3B8',
  },
  modal: {
    frame: '#475569',
    title: '#F8FAFC',
    body: '#CBD5E1',
    footer: '#94A3B8',
    background: '#1E293B',
  },
  terminal: {
    palette: ANSI_16_DARK,
    foreground: '#E2E8F0',
    background: '#0F172A',
    cursor: '#60A5FA',
    selection: '#1E3A5F',
  },
  diff: {
    added: '#22C55E',
    removed: '#EF4444',
    context: '#94A3B8',
    hunkHeader: '#94A3B8',
    addedBg: '#132F21',
    removedBg: '#3B1219',
    contextBg: '#1E293B',
    lineNumber: '#475569',
    highlightAdded: '#4ADE80',
    highlightRemoved: '#FB7185',
  },
  markdown: {
    text: '#E2E8F0',
    heading: '#38BDF8',
    link: '#60A5FA',
    linkText: '#38BDF8',
    code: '#A3BE8C',
    blockQuote: '#94A3B8',
    emphasis: '#F59E0B',
    strong: '#FBBF24',
    horizontalRule: '#475569',
    listItem: '#38BDF8',
    listEnumeration: '#38BDF8',
    codeBlock: '#E2E8F0',
  },
  syntax: {
    comment: '#64748B',
    keyword: '#60A5FA',
    function: '#38BDF8',
    variable: '#8FBCBB',
    string: '#A3BE8C',
    number: '#B48EAD',
    type: '#8FBCBB',
    operator: '#60A5FA',
    punctuation: '#E2E8F0',
  },
};

export const LIGHT_THEME: Theme = {
  mode: 'light',
  colors: {
    text: '#0F172A',
    textMuted: '#64748B',
    textAccent: '#2563EB',
    background: '#FFFFFF',
    backgroundPanel: '#F1F5F9',
    backgroundOverlay: '#DBEAFE',
    border: '#CBD5E1',
    borderFocused: '#2563EB',
    primary: '#2563EB',
    secondary: '#4F46E5',
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
    selection: '#DBEAFE',
    cursor: '#2563EB',
  },
  input: {
    text: '#0F172A',
    placeholder: '#64748B',
    background: '#FFFFFF',
    focusedBackground: '#F8FAFC',
    focusedBorder: '#2563EB',
    cursor: '#2563EB',
  },
  select: {
    text: '#0F172A',
    selectedText: '#1D4ED8',
    selectedBackground: '#DBEAFE',
    description: '#475569',
    selectedDescription: '#1E40AF',
  },
  modal: {
    frame: '#CBD5E1',
    title: '#0F172A',
    body: '#334155',
    footer: '#64748B',
    background: '#FFFFFF',
  },
  terminal: {
    palette: ANSI_16_LIGHT,
    foreground: '#0F172A',
    background: '#FFFFFF',
    cursor: '#2563EB',
    selection: '#DBEAFE',
  },
  diff: {
    added: '#16A34A',
    removed: '#DC2626',
    context: '#64748B',
    hunkHeader: '#64748B',
    addedBg: '#DCFCE7',
    removedBg: '#FEE2E2',
    contextBg: '#F1F5F9',
    lineNumber: '#94A3B8',
    highlightAdded: '#22C55E',
    highlightRemoved: '#EF4444',
  },
  markdown: {
    text: '#0F172A',
    heading: '#2563EB',
    link: '#2563EB',
    linkText: '#1D4ED8',
    code: '#16A34A',
    blockQuote: '#64748B',
    emphasis: '#D97706',
    strong: '#B45309',
    horizontalRule: '#CBD5E1',
    listItem: '#2563EB',
    listEnumeration: '#2563EB',
    codeBlock: '#0F172A',
  },
  syntax: {
    comment: '#94A3B8',
    keyword: '#2563EB',
    function: '#0284C7',
    variable: '#0F766E',
    string: '#16A34A',
    number: '#9333EA',
    type: '#0F766E',
    operator: '#2563EB',
    punctuation: '#0F172A',
  },
};

export function defaultTheme(mode: ThemeMode): Theme {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}

export interface OpenCodeThemeColors {
  readonly titleColor?: string;
  readonly borderColor?: string;
  readonly focusedBorderColor?: string;
  readonly inputTextColor?: string;
  readonly inputFocusedTextColor?: string;
  readonly inputPlaceholderColor?: string;
  readonly inputCursorColor?: string;
  readonly selectSelectedBackgroundColor?: string;
  readonly selectTextColor?: string;
  readonly selectSelectedTextColor?: string;
  readonly selectDescriptionColor?: string;
  readonly selectSelectedDescriptionColor?: string;
  readonly instructionsColor?: string;
}

export function fromOpenCodeTheme(mode: ThemeMode, oc: OpenCodeThemeColors): Theme {
  const base = defaultTheme(mode);
  return {
    mode,
    colors: {
      ...base.colors,
      ...(oc.borderColor !== undefined ? { border: oc.borderColor } : {}),
      ...(oc.focusedBorderColor !== undefined ? { borderFocused: oc.focusedBorderColor } : {}),
      ...(oc.selectTextColor !== undefined ? { text: oc.selectTextColor } : {}),
      ...(oc.instructionsColor !== undefined ? { textMuted: oc.instructionsColor } : {}),
    },
    input: {
      ...base.input,
      ...(oc.inputTextColor !== undefined ? { text: oc.inputTextColor } : {}),
      ...(oc.inputPlaceholderColor !== undefined ? { placeholder: oc.inputPlaceholderColor } : {}),
      ...(oc.inputCursorColor !== undefined ? { cursor: oc.inputCursorColor } : {}),
      ...(oc.focusedBorderColor !== undefined ? { focusedBorder: oc.focusedBorderColor } : {}),
    },
    select: {
      ...base.select,
      ...(oc.selectTextColor !== undefined ? { text: oc.selectTextColor } : {}),
      ...(oc.selectSelectedTextColor !== undefined
        ? { selectedText: oc.selectSelectedTextColor }
        : {}),
      ...(oc.selectSelectedBackgroundColor !== undefined
        ? { selectedBackground: oc.selectSelectedBackgroundColor }
        : {}),
      ...(oc.selectDescriptionColor !== undefined
        ? { description: oc.selectDescriptionColor }
        : {}),
      ...(oc.selectSelectedDescriptionColor !== undefined
        ? { selectedDescription: oc.selectSelectedDescriptionColor }
        : {}),
    },
    modal: base.modal,
    terminal: base.terminal,
    diff: base.diff,
    markdown: base.markdown,
    syntax: base.syntax,
  };
}
