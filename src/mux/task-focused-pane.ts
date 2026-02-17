import { padOrTrimDisplay } from './dual-pane-core.ts';
import { type TaskStatus } from './harness-core-ui.ts';
import { formatUiButton } from '../ui/kit.ts';
import {
  taskComposerTextFromTaskFields,
  taskComposerVisibleLines,
  type TaskComposerBuffer
} from './task-composer.ts';

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
  readonly archivedAt: string | null;
}

export interface TaskFocusedPaneTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly description: string;
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
  readonly taskIds: readonly (string | null)[];
  readonly repositoryIds: readonly (string | null)[];
  readonly actions: readonly (TaskFocusedPaneAction | null)[];
  readonly actionCells: readonly (readonly ActionCell[] | null)[];
  readonly top: number;
  readonly selectedRepositoryId: string | null;
}

const READY_CHIP_LABEL = formatUiButton({
  label: 'ready',
  prefixIcon: 'r'
});
const DRAFT_CHIP_LABEL = formatUiButton({
  label: 'queued',
  prefixIcon: 'd'
});
const COMPLETE_CHIP_LABEL = formatUiButton({
  label: 'complete',
  prefixIcon: 'c'
});

function sortedRepositories(
  repositories: ReadonlyMap<string, TaskFocusedPaneRepositoryRecord>
): readonly TaskFocusedPaneRepositoryRecord[] {
  return [...repositories.values()]
    .filter((entry) => entry.archivedAt === null)
    .sort((left, right) => left.name.localeCompare(right.name) || left.repositoryId.localeCompare(right.repositoryId));
}

function parseIsoMs(value: string): number {
  return Date.parse(value);
}

function sortTasksByOrderLocal(
  tasks: readonly TaskFocusedPaneTaskRecord[]
): readonly TaskFocusedPaneTaskRecord[] {
  return [...tasks].sort((left, right) => {
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

function composeRowWithRightChips(
  left: string,
  width: number,
  chips: readonly { label: string; action: TaskFocusedPaneAction }[]
): { readonly text: string; readonly cells: readonly ActionCell[] } {
  const joined = chips.map((chip) => chip.label).join(' ');
  if (joined.length === 0 || joined.length >= width) {
    return {
      text: padOrTrimDisplay(left, width),
      cells: []
    };
  }
  const startCol = Math.max(0, width - joined.length);
  const leftMax = Math.max(0, startCol - 1);
  const leftText = padOrTrimDisplay(truncate(left, leftMax), leftMax);
  const gap = width - leftText.length - joined.length;
  let cursor = leftText.length + Math.max(0, gap);
  const cells: ActionCell[] = [];
  const parts: string[] = [leftText, ' '.repeat(Math.max(0, gap))];
  for (let idx = 0; idx < chips.length; idx += 1) {
    const chip = chips[idx]!;
    parts.push(chip.label);
    cells.push({
      startCol: cursor,
      endCol: cursor + chip.label.length - 1,
      action: chip.action
    });
    cursor += chip.label.length;
    if (idx < chips.length - 1) {
      parts.push(' ');
      cursor += 1;
    }
  }
  return {
    text: padOrTrimDisplay(parts.join(''), width),
    cells
  };
}

function taskBufferFromRecord(
  task: TaskFocusedPaneTaskRecord,
  overrides: ReadonlyMap<string, TaskComposerBuffer>
): TaskComposerBuffer {
  return (
    overrides.get(task.taskId) ?? {
      text: taskComposerTextFromTaskFields(task.title, task.description),
      cursor: task.title.length
    }
  );
}

function taskPreviewText(task: TaskFocusedPaneTaskRecord): string {
  const summary = task.description.split('\n')[0] ?? '';
  if (summary.length === 0) {
    return task.title;
  }
  return `${task.title} · ${summary}`;
}

export function buildTaskFocusedPaneView(options: BuildTaskFocusedPaneOptions): TaskFocusedPaneView {
  const safeCols = Math.max(1, options.cols);
  const safeRows = Math.max(1, options.rows);
  const repositories = sortedRepositories(options.repositories);
  const selectedRepositoryId =
    (options.selectedRepositoryId !== null &&
    repositories.some((entry) => entry.repositoryId === options.selectedRepositoryId)
      ? options.selectedRepositoryId
      : null) ?? repositories[0]?.repositoryId ?? null;

  const scopedTasks = sortTasksByOrderLocal(
    [...options.tasks.values()].filter((task) => task.repositoryId === selectedRepositoryId)
  );

  const lines: PaneLine[] = [];
  const push = (
    text: string,
    taskId: string | null = null,
    repositoryId: string | null = null,
    action: TaskFocusedPaneAction | null = null,
    actionCells: readonly ActionCell[] | null = null
  ): void => {
    lines.push({
      text: padOrTrimDisplay(text, safeCols),
      taskId,
      repositoryId,
      action,
      actionCells
    });
  };

  push(' task composer');
  const selectedRepositoryName =
    selectedRepositoryId === null
      ? 'select repository'
      : repositories.find((entry) => entry.repositoryId === selectedRepositoryId)?.name ?? '(missing)';
  const repositoryButton = formatUiButton({
    label: truncate(selectedRepositoryName, Math.max(8, safeCols - 16)),
    suffixIcon: 'v'
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
            action: 'repository.dropdown.toggle' as const
          }
        ];
  push(repositoryRowText, null, selectedRepositoryId, 'repository.dropdown.toggle', repoCells);

  if (options.repositoryDropdownOpen) {
    for (const repository of repositories) {
      const activeMark = repository.repositoryId === selectedRepositoryId ? '●' : '○';
      push(
        `   ${activeMark} ${repository.name}`,
        null,
        repository.repositoryId,
        'repository.select'
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
    push(` tasks (${String(scopedTasks.length)})`);
    for (let index = 0; index < scopedTasks.length; index += 1) {
      const task = scopedTasks[index]!;
      const focused = options.editorTarget.kind === 'task' && options.editorTarget.taskId === task.taskId;
      const leftLabel = ` ${focused ? '▸' : ' '} ${statusGlyph(task.status)} ${truncate(taskPreviewText(task), Math.max(8, safeCols - 24))}`;
      const chips =
        task.status === 'completed'
          ? []
          : [
              { label: READY_CHIP_LABEL, action: 'task.status.ready' as const },
              { label: DRAFT_CHIP_LABEL, action: 'task.status.draft' as const },
              { label: COMPLETE_CHIP_LABEL, action: 'task.status.complete' as const }
            ];
      const composed = composeRowWithRightChips(leftLabel, safeCols, chips);
      push(composed.text, task.taskId, selectedRepositoryId, 'task.focus', composed.cells);

      if (focused) {
        const editBuffer = taskBufferFromRecord(task, options.taskBufferById);
        const linesWithCursor = taskComposerVisibleLines(editBuffer);
        push(`    ${padOrTrimDisplay('─'.repeat(Math.max(4, Math.min(20, safeCols - 4))), Math.max(0, safeCols - 4))}`);
        for (const line of linesWithCursor) {
          push(`    ${truncate(line, Math.max(1, safeCols - 4))}`, task.taskId, selectedRepositoryId, 'task.focus');
        }
      }
    }
  }

  push('');
  const draftFocused = options.editorTarget.kind === 'draft';
  push(` draft ${draftFocused ? '(editing)' : '(saved)'}`);
  const draftLines = draftFocused
    ? taskComposerVisibleLines(options.draftBuffer)
    : options.draftBuffer.text.length === 0
      ? ['']
      : options.draftBuffer.text.split('\n');
  for (const line of draftLines) {
    push(` > ${truncate(line, Math.max(1, safeCols - 3))}`);
  }
  push(' enter ready  tab queue  shift+enter newline  ctrl+g repos');

  const maxTop = Math.max(0, lines.length - safeRows);
  const top = Math.max(0, Math.min(maxTop, options.scrollTop));
  const viewport = lines.slice(top, top + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: ' '.repeat(safeCols),
      taskId: null,
      repositoryId: null,
      action: null,
      actionCells: null
    });
  }
  return {
    rows: viewport.map((line) => line.text),
    taskIds: viewport.map((line) => line.taskId),
    repositoryIds: viewport.map((line) => line.repositoryId),
    actions: viewport.map((line) => line.action),
    actionCells: viewport.map((line) => line.actionCells),
    top,
    selectedRepositoryId
  };
}

export function taskFocusedPaneActionAtRow(
  view: TaskFocusedPaneView,
  rowIndex: number
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
  colIndex: number
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
  rowIndex: number
): string | null {
  if (view.taskIds.length === 0) {
    return null;
  }
  const normalized = Math.max(0, Math.min(view.taskIds.length - 1, rowIndex));
  return view.taskIds[normalized] ?? null;
}

export function taskFocusedPaneRepositoryIdAtRow(
  view: TaskFocusedPaneView,
  rowIndex: number
): string | null {
  if (view.repositoryIds.length === 0) {
    return null;
  }
  const normalized = Math.max(0, Math.min(view.repositoryIds.length - 1, rowIndex));
  return view.repositoryIds[normalized] ?? null;
}
