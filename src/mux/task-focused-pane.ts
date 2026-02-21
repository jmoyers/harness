import { padOrTrimDisplay } from './dual-pane-core.ts';
import type { TaskStatus } from './harness-core-ui.ts';
import { UiKit } from '../../packages/harness-ui/src/kit.ts';
import { WrappingInputRenderer } from '../../packages/harness-ui/src/text-layout.ts';
import { taskComposerTextFromTaskFields, type TaskComposerBuffer } from './task-composer.ts';

const UI_KIT = new UiKit();
const WRAPPING_INPUT_RENDERER = new WrappingInputRenderer();

export type TaskFocusedPaneAction =
  | 'repository.dropdown.toggle'
  | 'repository.select'
  | 'task.focus'
  | 'task.status.ready'
  | 'task.status.draft'
  | 'task.status.complete';

interface ActionCell {
  readonly startCol: number;
  readonly endCol: number;
  readonly action: TaskFocusedPaneAction;
}

export interface TaskFocusedPaneRepositoryRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly metadata?: Record<string, unknown>;
  readonly archivedAt: string | null;
}

export interface TaskFocusedPaneTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: TaskStatus;
  readonly orderIndex: number;
  readonly createdAt: string;
}

export type TaskFocusedPaneEditorTarget =
  | {
      readonly kind: 'draft';
    }
  | {
      readonly kind: 'task';
      readonly taskId: string;
    };

interface BuildTaskFocusedPaneOptions {
  readonly repositories: ReadonlyMap<string, TaskFocusedPaneRepositoryRecord>;
  readonly tasks: ReadonlyMap<string, TaskFocusedPaneTaskRecord>;
  readonly selectedRepositoryId: string | null;
  readonly repositoryDropdownOpen: boolean;
  readonly editorTarget: TaskFocusedPaneEditorTarget;
  readonly draftBuffer: TaskComposerBuffer;
  readonly taskBufferById: ReadonlyMap<string, TaskComposerBuffer>;
  readonly notice: string | null;
  readonly cols: number;
  readonly rows: number;
  readonly scrollTop: number;
  readonly cursorVisible?: boolean;
}

interface PaneLine {
  readonly text: string;
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly action: TaskFocusedPaneAction | null;
  readonly actionCells: readonly ActionCell[] | null;
}

export interface TaskFocusedPaneView {
  readonly rows: readonly string[];
  readonly plainRows?: readonly string[];
  readonly taskIds: readonly (string | null)[];
  readonly repositoryIds: readonly (string | null)[];
  readonly actions: readonly (TaskFocusedPaneAction | null)[];
  readonly actionCells: readonly (readonly ActionCell[] | null)[];
  readonly top: number;
  readonly selectedRepositoryId: string | null;
}

function sortedRepositories(
  repositories: ReadonlyMap<string, TaskFocusedPaneRepositoryRecord>,
): readonly TaskFocusedPaneRepositoryRecord[] {
  return [...repositories.values()].filter((repository) => repository.archivedAt === null);
}

function parseIsoMs(value: string): number {
  return Date.parse(value);
}

function taskStatusSortRank(status: TaskStatus): number {
  if (status === 'in-progress') {
    return 0;
  }
  if (status === 'ready') {
    return 1;
  }
  if (status === 'draft') {
    return 2;
  }
  return 3;
}

function taskStatusGroupLabel(status: TaskStatus): string {
  if (status === 'in-progress') {
    return 'in prog';
  }
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'draft') {
    return 'draft';
  }
  return 'complete';
}

function compareTasksByOrder(
  left: TaskFocusedPaneTaskRecord,
  right: TaskFocusedPaneTaskRecord,
): number {
  if (left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }
  const leftTs = parseIsoMs(left.createdAt);
  const rightTs = parseIsoMs(right.createdAt);
  const leftFinite = Number.isFinite(leftTs);
  const rightFinite = Number.isFinite(rightTs);
  if (leftFinite && rightFinite && leftTs !== rightTs) {
    return leftTs - rightTs;
  }
  if (leftFinite !== rightFinite) {
    return leftFinite ? -1 : 1;
  }
  return left.taskId.localeCompare(right.taskId);
}

function sortTasksForDisplay(
  tasks: readonly TaskFocusedPaneTaskRecord[],
): readonly TaskFocusedPaneTaskRecord[] {
  return [...tasks].sort((left, right) => {
    const statusCompare = taskStatusSortRank(left.status) - taskStatusSortRank(right.status);
    if (statusCompare !== 0) {
      return statusCompare;
    }
    return compareTasksByOrder(left, right);
  });
}

function statusGlyph(status: TaskStatus): string {
  if (status === 'ready') {
    return '○';
  }
  if (status === 'in-progress') {
    return '◔';
  }
  if (status === 'completed') {
    return '✓';
  }
  return '◇';
}

function truncate(text: string, max: number): string {
  const safeMax = Math.max(1, max);
  if (text.length <= safeMax) {
    return text;
  }
  if (safeMax === 1) {
    return '…';
  }
  return `${text.slice(0, safeMax - 1)}…`;
}

function taskBufferFromRecord(
  task: TaskFocusedPaneTaskRecord,
  overrides: ReadonlyMap<string, TaskComposerBuffer>,
): TaskComposerBuffer {
  const text = taskComposerTextFromTaskFields(task.title, task.body);
  return (
    overrides.get(task.taskId) ?? {
      text,
      cursor: text.length,
    }
  );
}

function taskPreviewText(task: TaskFocusedPaneTaskRecord): string {
  const summary = task.body.split('\n')[0] ?? '';
  const trimmed = summary.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return task.title;
}

export function buildTaskFocusedPaneView(
  options: BuildTaskFocusedPaneOptions,
): TaskFocusedPaneView {
  const safeCols = Math.max(1, options.cols);
  const safeRows = Math.max(1, options.rows);
  const repositories = sortedRepositories(options.repositories);
  const selectedRepositoryId =
    (options.selectedRepositoryId !== null &&
    repositories.some((entry) => entry.repositoryId === options.selectedRepositoryId)
      ? options.selectedRepositoryId
      : null) ??
    repositories[0]?.repositoryId ??
    null;

  const scopedTasks = sortTasksForDisplay(
    [...options.tasks.values()].filter((task) => task.repositoryId === selectedRepositoryId),
  );

  const lines: PaneLine[] = [];
  const push = (
    text: string,
    taskId: string | null = null,
    repositoryId: string | null = null,
    action: TaskFocusedPaneAction | null = null,
    actionCells: readonly ActionCell[] | null = null,
  ): void => {
    lines.push({
      text: padOrTrimDisplay(text, safeCols),
      taskId,
      repositoryId,
      action,
      actionCells,
    });
  };

  push(' task composer');
  const selectedRepositoryName =
    selectedRepositoryId === null
      ? 'select repository'
      : (repositories.find((entry) => entry.repositoryId === selectedRepositoryId)?.name ??
        '(missing)');
  const repositoryButton = UI_KIT.formatButton({
    label: truncate(selectedRepositoryName, Math.max(8, safeCols - 16)),
    suffixIcon: 'v',
  });
  const repositoryRowText = ` repo: ${repositoryButton}`;
  const toggleStart = repositoryRowText.indexOf(repositoryButton);
  const repoCells =
    toggleStart < 0
      ? []
      : [
          {
            startCol: toggleStart,
            endCol: toggleStart + repositoryButton.length - 1,
            action: 'repository.dropdown.toggle' as const,
          },
        ];
  push(repositoryRowText, null, selectedRepositoryId, 'repository.dropdown.toggle', repoCells);

  if (options.repositoryDropdownOpen) {
    for (const repository of repositories) {
      const activeMark = repository.repositoryId === selectedRepositoryId ? '●' : '○';
      push(
        `   ${activeMark} ${repository.name}`,
        null,
        repository.repositoryId,
        'repository.select',
      );
    }
  }

  if (options.notice !== null && options.notice.length > 0) {
    push(` notice: ${truncate(options.notice, Math.max(1, safeCols - 9))}`);
  }

  push('');
  if (selectedRepositoryId === null) {
    push(' no repository selected');
  } else if (scopedTasks.length === 0) {
    push(' no tasks yet for this repository');
  } else {
    const statusCounts = new Map<TaskStatus, number>();
    for (const task of scopedTasks) {
      statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
    }
    push(` tasks (${String(scopedTasks.length)})`);
    let previousStatus: TaskStatus | null = null;
    for (let index = 0; index < scopedTasks.length; index += 1) {
      const task = scopedTasks[index]!;
      if (task.status !== previousStatus) {
        if (previousStatus !== null) {
          push('');
        }
        push(
          ` ${statusGlyph(task.status)} ${taskStatusGroupLabel(task.status)} · ${String(statusCounts.get(task.status) ?? 0)}`,
        );
        previousStatus = task.status;
      }
      const focused =
        options.editorTarget.kind === 'task' && options.editorTarget.taskId === task.taskId;
      if (focused) {
        const editBuffer = taskBufferFromRecord(task, options.taskBufferById);
        const editorInnerWidth = Math.max(1, safeCols - 4);
        const editorPrefix = `${statusGlyph(task.status)} `;
        const linesWithCursor = WRAPPING_INPUT_RENDERER.renderLines({
          buffer: editBuffer,
          width: editorInnerWidth,
          linePrefix: editorPrefix,
          cursorToken: '█',
          cursorVisible: options.cursorVisible ?? true,
        });
        push(` ┌${'─'.repeat(editorInnerWidth)}┐`);
        for (const line of linesWithCursor) {
          const content = padOrTrimDisplay(line, editorInnerWidth);
          push(` │${content}│`, task.taskId, selectedRepositoryId, 'task.focus');
        }
        push(` └${'─'.repeat(editorInnerWidth)}┘`);
        continue;
      }

      const leftLabel = `   ${statusGlyph(task.status)} ${truncate(taskPreviewText(task), Math.max(8, safeCols - 6))}`;
      push(leftLabel, task.taskId, selectedRepositoryId, 'task.focus');
    }
  }

  push('');
  const draftFocused = options.editorTarget.kind === 'draft';
  push(` draft ${draftFocused ? '(editing)' : '(saved)'}`);
  const draftInnerWidth = Math.max(1, safeCols - 4);
  push(` ┌${'─'.repeat(draftInnerWidth)}┐`);
  const draftLines = WRAPPING_INPUT_RENDERER.renderLines({
    buffer: options.draftBuffer,
    width: draftInnerWidth,
    cursorToken: '█',
    cursorVisible: draftFocused && (options.cursorVisible ?? true),
  });
  for (const line of draftLines) {
    const content = padOrTrimDisplay(line, draftInnerWidth);
    push(` │${content}│`);
  }
  push(` └${'─'.repeat(draftInnerWidth)}┘`);
  push(' enter ready  tab draft  shift+enter newline');
  push(' alt+g repos  ctrl+up/down reorder');

  const maxTop = Math.max(0, lines.length - safeRows);
  const top = Math.max(0, Math.min(maxTop, options.scrollTop));
  const viewport = lines.slice(top, top + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: ' '.repeat(safeCols),
      taskId: null,
      repositoryId: null,
      action: null,
      actionCells: null,
    });
  }
  return {
    rows: viewport.map((line) => line.text),
    plainRows: viewport.map((line) => line.text),
    taskIds: viewport.map((line) => line.taskId),
    repositoryIds: viewport.map((line) => line.repositoryId),
    actions: viewport.map((line) => line.action),
    actionCells: viewport.map((line) => line.actionCells),
    top,
    selectedRepositoryId,
  };
}

export function taskFocusedPaneActionAtRow(
  view: TaskFocusedPaneView,
  rowIndex: number,
): TaskFocusedPaneAction | null {
  if (view.actions.length === 0) {
    return null;
  }
  const normalized = Math.max(0, Math.min(view.actions.length - 1, rowIndex));
  return view.actions[normalized] ?? null;
}

export function taskFocusedPaneActionAtCell(
  view: TaskFocusedPaneView,
  rowIndex: number,
  colIndex: number,
): TaskFocusedPaneAction | null {
  if (view.rows.length === 0) {
    return null;
  }
  const normalizedRow = Math.max(0, Math.min(view.rows.length - 1, rowIndex));
  const normalizedCol = Math.max(0, Math.floor(colIndex));
  const cells = view.actionCells[normalizedRow] ?? null;
  if (cells !== null) {
    for (const cell of cells) {
      if (normalizedCol >= cell.startCol && normalizedCol <= cell.endCol) {
        return cell.action;
      }
    }
  }
  return taskFocusedPaneActionAtRow(view, normalizedRow);
}

export function taskFocusedPaneTaskIdAtRow(
  view: TaskFocusedPaneView,
  rowIndex: number,
): string | null {
  if (view.taskIds.length === 0) {
    return null;
  }
  const normalized = Math.max(0, Math.min(view.taskIds.length - 1, rowIndex));
  return view.taskIds[normalized] ?? null;
}

export function taskFocusedPaneRepositoryIdAtRow(
  view: TaskFocusedPaneView,
  rowIndex: number,
): string | null {
  if (view.repositoryIds.length === 0) {
    return null;
  }
  const normalized = Math.max(0, Math.min(view.repositoryIds.length - 1, rowIndex));
  return view.repositoryIds[normalized] ?? null;
}
