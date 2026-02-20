import { readFileSync } from 'node:fs';
import { createDiffBuilder } from '../diff/build.ts';
import type { DiffBuildResult, DiffBuilder } from '../diff/types.ts';
import { Screen } from '../ui/screen.ts';
import { parseDiffUiArgs } from './args.ts';
import { diffUiCommandToStateAction, parseDiffUiCommand } from './commands.ts';
import { buildDiffUiModel } from './model.ts';
import {
  runDiffUiPagerProcess,
  type DiffUiPagerInputStream,
  type DiffUiPagerOutputStream,
} from './pager.ts';
import { renderDiffUiDocument, renderDiffUiViewport, resolveDiffUiTheme } from './render.ts';
import { createInitialDiffUiState, reduceDiffUiState } from './state.ts';
import type { DiffUiCliOptions, DiffUiEvent, DiffUiRunOutput, DiffUiState } from './types.ts';

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
  readonly pagerStdin?: DiffUiPagerInputStream;
  readonly pagerStdout?: DiffUiPagerOutputStream;
  readonly createScreen?: (deps: {
    readonly writeOutput: (output: string) => void;
    readonly writeError: (output: string) => void;
  }) => Pick<Screen, 'markDirty' | 'flush'>;
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
  if (lines.length === 0) {
    return;
  }
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

function renderDocument(input: {
  readonly model: ReturnType<typeof buildDiffUiModel>;
  readonly options: DiffUiCliOptions;
}): readonly string[] {
  return renderDiffUiDocument({
    model: input.model,
    syntaxMode: input.options.syntaxMode,
    wordDiffMode: input.options.wordDiffMode,
    color: input.options.color,
    theme: resolveDiffUiTheme(input.options.theme),
  });
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
    let renderedLines: readonly string[] = [];

    if (options.pager) {
      const pagerResult = await runDiffUiPagerProcess({
        model,
        options,
        initialState: state,
        writeStdout,
        writeStderr,
        stdin: deps.pagerStdin ?? (process.stdin as unknown as DiffUiPagerInputStream),
        stdout: deps.pagerStdout ?? (process.stdout as unknown as DiffUiPagerOutputStream),
        createScreen:
          deps.createScreen ??
          ((screenDeps) => {
            return new Screen(screenDeps);
          }),
      });
      state = pagerResult.state;
      renderedLines = pagerResult.renderedLines;
      events.push(...pagerResult.events);
      return {
        exitCode: 0,
        events,
        renderedLines,
      };
    }

    if (options.rpcStdio) {
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

        const command = parseDiffUiCommand(parsed);
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

        const action = diffUiCommandToStateAction(command, pageSize);
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
    } else {
      renderedLines = renderDocument({
        model,
        options,
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
