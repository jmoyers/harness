import { readFileSync } from 'node:fs';
import { createDiffBuilder } from '../diff/build.ts';
import type { DiffBuildResult, DiffBuilder } from '../diff/types.ts';
import { parseDiffUiArgs } from './args.ts';
import { buildDiffUiModel } from './model.ts';
import { renderDiffUiViewport, resolveDiffUiTheme } from './render.ts';
import { createInitialDiffUiState, reduceDiffUiState } from './state.ts';
import type {
  DiffUiCliOptions,
  DiffUiCommand,
  DiffUiEvent,
  DiffUiRunOutput,
  DiffUiState,
  DiffUiStateAction,
} from './types.ts';

type DiffUiActionCommand = Exclude<DiffUiCommand, { readonly type: 'session.quit' }>;

interface RunDiffUiCliDeps {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
  readonly writeStdout?: (text: string) => void;
  readonly writeStderr?: (text: string) => void;
  readonly stdoutCols?: number;
  readonly stdoutRows?: number;
  readonly readStdinText?: () => string;
  readonly createBuilder?: () => DiffBuilder;
  readonly isStdoutTty?: boolean;
}

function parseCommand(value: unknown): DiffUiCommand | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') {
    return null;
  }

  if (type === 'view.setMode') {
    const mode = record['mode'];
    if (mode === 'auto' || mode === 'split' || mode === 'unified') {
      return { type, mode };
    }
    return null;
  }
  if (type === 'nav.scroll') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'nav.page') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'nav.gotoFile' || type === 'nav.gotoHunk') {
    const index = record['index'];
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      return null;
    }
    if (type === 'nav.gotoFile') {
      return { type, index };
    }
    return { type, index };
  }
  if (type === 'finder.open' || type === 'finder.close' || type === 'finder.accept') {
    return { type };
  }
  if (type === 'finder.query' || type === 'search.set') {
    const query = record['query'];
    if (typeof query !== 'string') {
      return null;
    }
    if (type === 'finder.query') {
      return { type, query };
    }
    return { type, query };
  }
  if (type === 'finder.move') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'session.quit') {
    return { type };
  }

  return null;
}

function commandToAction(command: DiffUiActionCommand, pageSize: number): DiffUiStateAction {
  switch (command.type) {
    case 'view.setMode':
      return {
        type: 'view.setMode',
        mode: command.mode,
      };
    case 'nav.scroll':
      return {
        type: 'nav.scroll',
        delta: Math.trunc(command.delta),
      };
    case 'nav.page':
      return {
        type: 'nav.page',
        delta: Math.trunc(command.delta),
        pageSize,
      };
    case 'nav.gotoFile':
      return {
        type: 'nav.gotoFile',
        fileIndex: Math.trunc(command.index),
      };
    case 'nav.gotoHunk':
      return {
        type: 'nav.gotoHunk',
        hunkIndex: Math.trunc(command.index),
      };
    case 'finder.open':
      return {
        type: 'finder.open',
      };
    case 'finder.close':
      return {
        type: 'finder.close',
      };
    case 'finder.query':
      return {
        type: 'finder.query',
        query: command.query,
      };
    case 'finder.move':
      return {
        type: 'finder.move',
        delta: Math.trunc(command.delta),
      };
    case 'finder.accept':
      return {
        type: 'finder.accept',
      };
    case 'search.set':
      return {
        type: 'search.set',
        query: command.query,
      };
  }
}

function viewportFromOptions(
  options: DiffUiCliOptions,
  deps: RunDiffUiCliDeps,
): {
  readonly width: number;
  readonly height: number;
} {
  const width = options.width ?? deps.stdoutCols ?? process.stdout.columns ?? 120;
  const height = options.height ?? deps.stdoutRows ?? process.stdout.rows ?? 40;
  return {
    width: Math.max(40, Math.floor(width)),
    height: Math.max(6, Math.floor(height)),
  };
}

function emitEvents(events: readonly DiffUiEvent[], writeStdout: (text: string) => void): void {
  for (const event of events) {
    writeStdout(`${JSON.stringify(event)}\n`);
  }
}

function emitRenderedLines(lines: readonly string[], writeStdout: (text: string) => void): void {
  writeStdout(`${lines.join('\n')}\n`);
}

function renderCurrentViewport(input: {
  readonly model: ReturnType<typeof buildDiffUiModel>;
  readonly state: DiffUiState;
  readonly options: DiffUiCliOptions;
  readonly width: number;
  readonly height: number;
}): readonly string[] {
  return renderDiffUiViewport({
    model: input.model,
    state: input.state,
    width: input.width,
    height: input.height,
    viewMode: input.options.viewMode,
    syntaxMode: input.options.syntaxMode,
    wordDiffMode: input.options.wordDiffMode,
    color: input.options.color,
    theme: resolveDiffUiTheme(input.options.theme),
  }).lines;
}

async function buildDiffResult(
  options: DiffUiCliOptions,
  builder: DiffBuilder,
): Promise<DiffBuildResult> {
  const gitOptions =
    options.renameLimit === null
      ? {
          noRenames: options.noRenames,
        }
      : {
          noRenames: options.noRenames,
          renameLimit: options.renameLimit,
        };

  const buildOptions = {
    cwd: options.cwd,
    mode: options.mode,
    ...(options.baseRef !== null ? { baseRef: options.baseRef } : {}),
    ...(options.headRef !== null ? { headRef: options.headRef } : {}),
    includeGenerated: options.includeGenerated,
    includeBinary: options.includeBinary,
    git: gitOptions,
    budget: options.budget,
  };

  return await builder.build(buildOptions);
}

export async function runDiffUiCli(deps: RunDiffUiCliDeps = {}): Promise<DiffUiRunOutput> {
  const writeStdout = deps.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = deps.writeStderr ?? ((text) => process.stderr.write(text));
  const argv = deps.argv ?? process.argv.slice(2);
  const events: DiffUiEvent[] = [];

  try {
    const options = parseDiffUiArgs(argv, {
      ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {}),
      ...(deps.isStdoutTty !== undefined ? { isStdoutTty: deps.isStdoutTty } : {}),
    });

    if (options.watch) {
      events.push({
        type: 'warning',
        message: '--watch is parsed but not yet implemented; running one-shot render',
      });
    }

    const builder = deps.createBuilder?.() ?? createDiffBuilder();
    const diffResult = await buildDiffResult(options, builder);
    const model = buildDiffUiModel(diffResult.diff);
    const viewport = viewportFromOptions(options, deps);
    const pageSize = Math.max(1, viewport.height - 2);

    events.push({
      type: 'diff.loaded',
      files: model.diff.totals.filesChanged,
      hunks: model.diff.totals.hunks,
      lines: model.diff.totals.lines,
      coverageReason: model.diff.coverage.reason,
    });

    let state = createInitialDiffUiState(model, options.viewMode, viewport.width);
    let renderedLines = renderCurrentViewport({
      model,
      state,
      options,
      width: viewport.width,
      height: viewport.height,
    });

    events.push({
      type: 'state.changed',
      state,
    });
    events.push({
      type: 'render.completed',
      rows: renderedLines.length,
      width: viewport.width,
      height: viewport.height,
      view: state.effectiveViewMode,
    });

    if (options.rpcStdio) {
      const stdinText = deps.readStdinText?.() ?? readFileSync(0, 'utf8');
      for (const rawLine of stdinText.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          events.push({
            type: 'warning',
            message: `invalid json command: ${line}`,
          });
          continue;
        }

        const command = parseCommand(parsed);
        if (command === null) {
          events.push({
            type: 'warning',
            message: `invalid command payload: ${line}`,
          });
          continue;
        }
        if (command.type === 'session.quit') {
          events.push({
            type: 'session.quit',
          });
          break;
        }

        const action = commandToAction(command, pageSize);
        state = reduceDiffUiState({
          model,
          state,
          action,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        });
        renderedLines = renderCurrentViewport({
          model,
          state,
          options,
          width: viewport.width,
          height: viewport.height,
        });

        events.push({
          type: 'state.changed',
          state,
        });
        events.push({
          type: 'render.completed',
          rows: renderedLines.length,
          width: viewport.width,
          height: viewport.height,
          view: state.effectiveViewMode,
        });
      }
    }

    if (options.jsonEvents || options.rpcStdio) {
      emitEvents(events, writeStdout);
    } else {
      emitRenderedLines(renderedLines, writeStdout);
    }

    return {
      exitCode: 0,
      events,
      renderedLines,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeStderr(`[diff-ui] ${message}\n`);
    const warning: DiffUiEvent = {
      type: 'warning',
      message,
    };
    return {
      exitCode: 1,
      events: [warning],
      renderedLines: [],
    };
  }
}
