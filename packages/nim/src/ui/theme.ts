import {
  DEFAULT_CELL_STYLE,
  parseHexColor,
  type CellStyle,
  type Color,
} from '../../../harness-ui/src/core/color.ts';

export const nimColors = {
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
  bg: Color = colorFromHex(nimColors.background),
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

const BG = colorFromHex(nimColors.background);
const PANEL = colorFromHex(nimColors.panel);
const PANEL_ALT = colorFromHex(nimColors.element);

export const TH = {
  bg: style(colorFromHex(nimColors.text), BG),
  text: style(colorFromHex(nimColors.text), BG),
  muted: style(colorFromHex(nimColors.muted), BG),
  strong: style(colorFromHex(nimColors.text), BG, true),
  modeBuild: style(colorFromHex(nimColors.primary), BG, true),
  modePlan: style(colorFromHex(nimColors.accent), BG, true),
  border: style(colorFromHex(nimColors.border), BG),
  borderSubtle: style(colorFromHex(nimColors.borderSubtle), BG),
  panel: style(colorFromHex(nimColors.text), PANEL),
  panelMuted: style(colorFromHex(nimColors.muted), PANEL),
  panelStrong: style(colorFromHex(nimColors.text), PANEL, true),
  panelAccent: style(colorFromHex(nimColors.primary), PANEL, true),
  panelSecondary: style(colorFromHex(nimColors.secondary), PANEL),
  panelKey: style(colorFromHex(nimColors.text), PANEL),
  userBg: style(colorFromHex(nimColors.text), PANEL),
  userPipeBuild: style(colorFromHex(nimColors.primary), PANEL, true),
  userPipePlan: style(colorFromHex(nimColors.accent), PANEL, true),
  assistantText: style(colorFromHex(nimColors.text), BG),
  assistantHeading: style(colorFromHex(nimColors.accent), BG, true),
  assistantQuote: style(colorFromHex(nimColors.muted), BG),
  assistantMeta: style(colorFromHex(nimColors.muted), BG),
  codeBg: style(colorFromHex(nimColors.text), PANEL_ALT),
  codeText: style(colorFromHex(nimColors.text), PANEL_ALT),
  diffAdd: style(colorFromHex(nimColors.diffAdded), BG),
  diffRemove: style(colorFromHex(nimColors.diffRemoved), BG),
  toolPending: style(colorFromHex(nimColors.primary), BG),
  toolDone: style(colorFromHex(nimColors.muted), BG),
  toolError: style(colorFromHex(nimColors.error), BG),
  toolName: style(colorFromHex(nimColors.secondary), BG),
  footerText: style(colorFromHex(nimColors.muted), BG),
  footerKey: style(colorFromHex(nimColors.text), BG),
  sideBg: style(colorFromHex(nimColors.text), PANEL),
  sideTitle: style(colorFromHex(nimColors.text), PANEL, true),
  sideMuted: style(colorFromHex(nimColors.muted), PANEL),
  sideValue: style(colorFromHex(nimColors.text), PANEL),
  sideDotOn: style(colorFromHex(nimColors.success), PANEL),
  sideDotError: style(colorFromHex(nimColors.error), PANEL),
  sideDotOff: style(colorFromHex(nimColors.muted), PANEL),
  tipDot: style(colorFromHex(nimColors.warning), BG),
  tipLabel: style(colorFromHex(nimColors.warning), BG, true),
  tipText: style(colorFromHex(nimColors.muted), BG),
};
