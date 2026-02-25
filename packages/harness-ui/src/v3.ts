// Core
export { CellBuffer, ClippedCellBuffer, type Cell, type Rect } from './core/cell-buffer.ts';
export {
  DEFAULT_COLOR,
  DEFAULT_CELL_STYLE,
  rgbColor,
  indexedColor,
  parseHexColor,
  colorEqual,
  colorToHex,
  colorSgrParams,
  cellStyleEqual,
  cellStyleToSgr,
  type Color,
  type CellStyle,
} from './core/color.ts';
export {
  measureDisplayWidth,
  wrapTextForColumns,
  TextLayoutEngine,
  WrappingInputRenderer,
  type WrappingInputBuffer,
  type RenderWrappingInputLinesOptions,
} from './text-layout.ts';
export { Screen, ProcessScreenWriter, DefaultScreenAnsiValidator } from './screen.ts';
export {
  diffRenderedRows,
  cursorStyleToDecscusr,
  cursorStyleEqual,
  findAnsiIntegrityIssues,
} from './frame-primitives.ts';

// Widget system
export {
  Widget,
  ZERO_RECT,
  ZERO_INSETS,
  edgeInsets,
  resetAutoIdCounter,
  type Rect as WidgetRect,
  type LayoutValue,
  type FlexDirection,
  type AlignItems,
  type JustifyContent,
  type Overflow,
  type EdgeInsets,
} from './widget/widget.ts';
export { computeLayout } from './widget/layout.ts';
export {
  renderWidgetTree,
  renderWidgetTreeIncremental,
  type RenderResult,
  type IncrementalRenderResult,
} from './widget/renderer.ts';
export { FrameBuffer, type FrameDiff } from './core/frame-buffer.ts';
export { reactive } from './widget/reactive.ts';
export { Message } from './widget/message.ts';
export { FocusManager } from './widget/focus.ts';
export {
  parseKeyInput,
  parseSgrMouse,
  parseInput,
  type KeyEvent,
  type MouseEvent,
  type PasteEvent,
  type InputEvent,
  type InputHandler,
} from './widget/input.ts';
export {
  resolveKeybinding,
  dispatchKeyToBindings,
  executeBinding,
  collectAllBindings,
  type Binding,
  type ResolvedBinding,
} from './widget/keybinding.ts';

// Theme
export type {
  Theme,
  ThemeMode,
  ThemeColors,
  ThemeInput,
  ThemeSelect,
  ThemeModal,
  ThemeTerminal,
  ThemeDiff,
  ThemeMarkdown,
  ThemeSyntax,
} from './theme/theme.ts';
export {
  DARK_THEME,
  LIGHT_THEME,
  defaultTheme,
  fromOpenCodeTheme,
  type OpenCodeThemeColors,
} from './theme/defaults.ts';

// Widgets
export { Text, TextWidget, type TextProps, type TextAlign } from './widgets/text.ts';
export {
  Box,
  BoxWidget,
  Row,
  Column,
  Spacer,
  SpacerWidget,
  type BoxProps,
  type BorderStyle,
} from './widgets/box.ts';
export {
  TextInput,
  TextInputWidget,
  InputChanged,
  InputSubmitted,
  type TextInputProps,
} from './widgets/text-input.ts';
export {
  TextArea,
  TextAreaWidget,
  TextAreaChanged,
  TextAreaSubmitted,
  type TextAreaProps,
} from './widgets/text-area.ts';
export {
  Select,
  SelectWidget,
  ItemSelected,
  type SelectProps,
  type SelectOption,
} from './widgets/select.ts';
export { ScrollView, ScrollViewWidget, type ScrollViewProps } from './widgets/scroll-view.ts';
export {
  Modal,
  ModalWidget,
  ModalDismissed,
  type ModalProps,
  type ModalAnchor,
} from './widgets/modal.ts';
export {
  TreeView,
  TreeViewWidget,
  TreeItemSelected,
  TreeItemExpanded,
  TreeItemCollapsed,
  type TreeViewProps,
  type TreeNode,
} from './widgets/tree-view.ts';
export {
  ListView,
  ListViewWidget,
  ListItemSelected,
  type ListViewProps,
  type ListItem,
} from './widgets/list-view.ts';
export {
  Dropdown,
  DropdownWidget,
  DropdownChanged,
  type DropdownProps,
  type DropdownOption,
} from './widgets/dropdown.ts';
export {
  Table,
  TableWidget,
  type TableProps,
  type TableColumn,
  type ColumnAlign,
} from './widgets/table.ts';
export {
  PaneDivider,
  PaneDividerWidget,
  DividerMoved,
  type PaneDividerProps,
  type DividerOrientation,
} from './widgets/pane-divider.ts';
export {
  Canvas,
  CanvasWidget,
  type CanvasProps,
  type CanvasRenderCallback,
} from './widgets/canvas.ts';
export {
  Terminal,
  TerminalWidgetImpl,
  TerminalData,
  TerminalTitleChanged,
  TerminalBell,
  type TerminalWidgetProps,
} from './widgets/terminal.ts';
export {
  CommandPalette,
  CommandPaletteWidget,
  CommandExecuted,
  CommandPaletteDismissed,
  type CommandPaletteProps,
  type CommandAction,
} from './widgets/command-palette.ts';
export {
  TurnActivityStrip,
  TurnActivityStripWidget,
  spinnerFrameAt,
  formatTurnActivityLine,
  type TurnActivityState,
  type TurnActivitySummary,
  type TurnActivityFormatInput,
  type TurnActivityStripProps,
} from './widgets/turn-activity-strip.ts';
export {
  DataTableCompact,
  DataTableCompactWidget,
  buildDataTableCompactLines,
  type DataTableCompactLine,
  type DataTableCompactLineKind,
  type BuildDataTableCompactLinesInput,
  type DataTableCompactProps,
} from './widgets/data-table-compact.ts';
export {
  MarkdownTranscript,
  MarkdownTranscriptWidget,
  buildMarkdownTranscriptLines,
  type MarkdownTranscriptLine,
  type MarkdownTranscriptLineKind,
  type BuildMarkdownTranscriptLinesInput,
  type MarkdownTranscriptColors,
  type MarkdownTranscriptProps,
} from './widgets/markdown-transcript.ts';
export {
  ToolCallTimeline,
  ToolCallTimelineWidget,
  summarizeToolCalls,
  toolStatusIcon,
  buildToolCallTimelineLines,
  type ToolCallTimelineStatus,
  type ToolCallTimelineItem,
  type ToolCallTimelineSummary,
  type ToolCallTimelineLine,
  type ToolCallTimelineLineKind,
  type BuildToolCallTimelineLinesInput,
  type ToolCallTimelineProps,
} from './widgets/tool-call-timeline.ts';
export {
  MessageCard,
  MessageCardWidget,
  messageCardRoleLabel,
  formatMessageCardMetaLine,
  type MessageCardRole,
  type MessageCardMetaInput,
  type MessageCardProps,
} from './widgets/message-card.ts';

// VTE
export { Vte, replayTerminalSteps } from './vte/vte.ts';
export {
  renderSnapshotAnsiRow,
  renderSnapshotText,
  diffTerminalFrames,
  type TerminalReplayStep,
  type TerminalFrameDiff,
} from './vte/render.ts';
export type {
  TerminalColor,
  TerminalCellStyle,
  TerminalCell,
  TerminalSnapshotLine,
  TerminalModeState,
  TerminalSnapshotFrameCore,
  TerminalSnapshotFrame,
  TerminalBufferTail,
  TerminalQueryState,
  TerminalQueryHooks,
  TerminalCursorStyle,
  TerminalCursorShape,
  ActiveScreen,
} from './vte/types.ts';

// Testing (re-export for convenience — full API in ./testing.ts)
export { createTestPilot, TestPilot, type TestPilotOptions } from './testing/pilot.ts';
