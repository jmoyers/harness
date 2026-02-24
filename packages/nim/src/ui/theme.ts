import {
  DEFAULT_CELL_STYLE,
  parseHexColor,
  type CellStyle,
  type Color,
} from '../../../harness-ui/src/core/color.ts';

export const NIM_COLORS = {
  background: '#0A0A0A',
  panel: '#141414',
  element: '#1E1E1E',
  border: '#484848',
  borderSubtle: '#3C3C3C',
  text: '#EEEEEE',
  muted: '#808080',
  primary: '#FAB283',
  secondary: '#5C9CF5',
  accent: '#9D7CD8',
  success: '#7FD88F',
  warning: '#F5A742',
  error: '#E06C75',
  diffAdded: '#4FD6BE',
  diffRemoved: '#C53B53',
} as const;

function colorFromHex(hex: string): Color {
  return parseHexColor(hex) ?? { kind: 'default' };
}

function style(
  fg: Color,
  bg: Color = colorFromHex(NIM_COLORS.background),
  bold = false,
  dim = false,
): CellStyle {
  return {
    ...DEFAULT_CELL_STYLE,
    fg,
    bg,
    bold,
    dim,
    italic: false,
    underline: false,
    inverse: false,
  };
}

const BG = colorFromHex(NIM_COLORS.background);
const PANEL = colorFromHex(NIM_COLORS.panel);
const PANEL_ALT = colorFromHex(NIM_COLORS.element);

export const TH = {
  bg: style(colorFromHex(NIM_COLORS.text), BG),
  text: style(colorFromHex(NIM_COLORS.text), BG),
  muted: style(colorFromHex(NIM_COLORS.muted), BG),
  strong: style(colorFromHex(NIM_COLORS.text), BG, true),
  modeBuild: style(colorFromHex(NIM_COLORS.primary), BG, true),
  modePlan: style(colorFromHex(NIM_COLORS.accent), BG, true),
  border: style(colorFromHex(NIM_COLORS.border), BG),
  borderSubtle: style(colorFromHex(NIM_COLORS.borderSubtle), BG),
  panel: style(colorFromHex(NIM_COLORS.text), PANEL),
  panelMuted: style(colorFromHex(NIM_COLORS.muted), PANEL),
  panelStrong: style(colorFromHex(NIM_COLORS.text), PANEL, true),
  panelAccent: style(colorFromHex(NIM_COLORS.primary), PANEL, true),
  panelSecondary: style(colorFromHex(NIM_COLORS.secondary), PANEL),
  panelKey: style(colorFromHex(NIM_COLORS.text), PANEL),
  userBg: style(colorFromHex(NIM_COLORS.text), PANEL),
  userPipeBuild: style(colorFromHex(NIM_COLORS.primary), PANEL, true),
  userPipePlan: style(colorFromHex(NIM_COLORS.accent), PANEL, true),
  assistantText: style(colorFromHex(NIM_COLORS.text), BG),
  assistantHeading: style(colorFromHex(NIM_COLORS.accent), BG, true),
  assistantQuote: style(colorFromHex(NIM_COLORS.muted), BG),
  assistantMeta: style(colorFromHex(NIM_COLORS.muted), BG),
  codeBg: style(colorFromHex(NIM_COLORS.text), PANEL_ALT),
  codeText: style(colorFromHex(NIM_COLORS.text), PANEL_ALT),
  diffAdd: style(colorFromHex(NIM_COLORS.diffAdded), BG),
  diffRemove: style(colorFromHex(NIM_COLORS.diffRemoved), BG),
  toolPending: style(colorFromHex(NIM_COLORS.primary), BG),
  toolDone: style(colorFromHex(NIM_COLORS.muted), BG),
  toolError: style(colorFromHex(NIM_COLORS.error), BG),
  toolName: style(colorFromHex(NIM_COLORS.secondary), BG),
  footerText: style(colorFromHex(NIM_COLORS.muted), BG),
  footerKey: style(colorFromHex(NIM_COLORS.text), BG),
  sideBg: style(colorFromHex(NIM_COLORS.text), PANEL),
  sideTitle: style(colorFromHex(NIM_COLORS.text), PANEL, true),
  sideMuted: style(colorFromHex(NIM_COLORS.muted), PANEL),
  sideValue: style(colorFromHex(NIM_COLORS.text), PANEL),
  sideDotOn: style(colorFromHex(NIM_COLORS.success), PANEL),
  sideDotError: style(colorFromHex(NIM_COLORS.error), PANEL),
  sideDotOff: style(colorFromHex(NIM_COLORS.muted), PANEL),
  tipDot: style(colorFromHex(NIM_COLORS.warning), BG),
  tipLabel: style(colorFromHex(NIM_COLORS.warning), BG, true),
  tipText: style(colorFromHex(NIM_COLORS.muted), BG),
};
