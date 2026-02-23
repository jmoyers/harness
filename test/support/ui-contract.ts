import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Cell } from '../../packages/harness-ui/src/core/cell-buffer.ts';
import type { Color, CellStyle } from '../../packages/harness-ui/src/core/color.ts';
import type { TestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';

const FIXTURE_ROOT = resolve(process.cwd(), 'test/fixtures/ui-contracts');
const UPDATE_ENV_NAME = 'HARNESS_UPDATE_UI_CONTRACTS';

interface UiContractSnapshotStyle {
  readonly fg: string;
  readonly bg: string;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

interface UiContractSnapshotRow {
  readonly text: string;
  readonly ansi: string;
  readonly baseStyle: string;
  readonly decoratedCells: readonly {
    readonly col: number;
    readonly glyph: string;
    readonly continued: boolean;
    readonly style: string;
  }[];
}

export interface UiContractSnapshot {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly viewport: {
    readonly cols: number;
    readonly rows: number;
  };
  readonly metadata: Record<string, string | number | boolean | null>;
  readonly styles: Record<string, UiContractSnapshotStyle>;
  readonly rows: readonly UiContractSnapshotRow[];
}

export interface UiContractSnapshotOptions {
  readonly name: string;
  readonly pilot: TestPilot;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

function colorToken(color: Color): string {
  if (color.kind === 'default') {
    return 'default';
  }
  if (color.kind === 'indexed') {
    return `idx:${String(color.index)}`;
  }
  return `rgb:${String(color.r)},${String(color.g)},${String(color.b)}`;
}

function styleToken(style: CellStyle): string {
  return [
    colorToken(style.fg),
    colorToken(style.bg),
    style.bold ? '1' : '0',
    style.dim ? '1' : '0',
    style.italic ? '1' : '0',
    style.underline ? '1' : '0',
    style.inverse ? '1' : '0',
  ].join('|');
}

function serializeStyle(style: CellStyle): UiContractSnapshotStyle {
  return {
    fg: colorToken(style.fg),
    bg: colorToken(style.bg),
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
  };
}

function nonNullCell(cell: Cell | null, col: number, row: number): Cell {
  if (cell !== null) {
    return cell;
  }
  throw new Error(`expected in-bounds cell at row=${String(row)} col=${String(col)}`);
}

export function createUiContractSnapshot(input: UiContractSnapshotOptions): UiContractSnapshot {
  const styleIdByToken = new Map<string, string>();
  const styles: Record<string, UiContractSnapshotStyle> = {};
  const rows: UiContractSnapshotRow[] = [];
  let nextStyleId = 1;

  for (let row = 0; row < input.pilot.rows; row += 1) {
    const rowCells: {
      readonly col: number;
      readonly glyph: string;
      readonly continued: boolean;
      readonly style: string;
    }[] = [];
    const styleCounts = new Map<string, number>();
    for (let col = 0; col < input.pilot.cols; col += 1) {
      const cell = nonNullCell(input.pilot.buffer.getCell(col, row), col, row);
      const token = styleToken(cell.style);
      const existingStyleId = styleIdByToken.get(token);
      const styleId = existingStyleId ?? `s${String(nextStyleId)}`;
      if (existingStyleId === undefined) {
        nextStyleId += 1;
        styleIdByToken.set(token, styleId);
        styles[styleId] = serializeStyle(cell.style);
      }
      rowCells.push({
        col,
        glyph: cell.glyph,
        continued: cell.continued,
        style: styleId,
      });
      styleCounts.set(styleId, (styleCounts.get(styleId) ?? 0) + 1);
    }

    let baseStyle = rowCells[0]?.style ?? 's0';
    let maxCount = -1;
    for (const [styleId, count] of styleCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        baseStyle = styleId;
      }
    }
    rows.push({
      text: input.pilot.rowText(row),
      ansi: input.pilot.ansiRow(row),
      baseStyle,
      decoratedCells: rowCells.filter(
        (cell) => cell.style !== baseStyle || cell.continued || cell.glyph !== ' ',
      ),
    });
  }

  return {
    schemaVersion: 1,
    name: input.name,
    viewport: {
      cols: input.pilot.cols,
      rows: input.pilot.rows,
    },
    metadata: {
      ...input.metadata,
    },
    styles,
    rows,
  };
}

function fixturePathForName(name: string): string {
  const candidate = resolve(FIXTURE_ROOT, `${name}.json`);
  const allowedPrefix = `${FIXTURE_ROOT}/`;
  if (!(candidate === FIXTURE_ROOT || candidate.startsWith(allowedPrefix))) {
    throw new Error(`contract name escapes fixture root: ${name}`);
  }
  return candidate;
}

function readFixture(path: string): UiContractSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as UiContractSnapshot;
}

function writeFixture(path: string, snapshot: UiContractSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export function assertUiContractSnapshot(snapshot: UiContractSnapshot): void {
  const path = fixturePathForName(snapshot.name);
  const update = process.env[UPDATE_ENV_NAME] === '1';

  if (update) {
    writeFixture(path, snapshot);
    return;
  }

  let expected: UiContractSnapshot;
  try {
    expected = readFixture(path);
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code !== 'ENOENT') {
      throw error;
    }
    throw new Error(`missing UI contract fixture at ${path}; regenerate with ${UPDATE_ENV_NAME}=1`);
  }

  assert.deepEqual(
    snapshot,
    expected,
    `ui contract mismatch for "${snapshot.name}" (${path}); regenerate with ${UPDATE_ENV_NAME}=1`,
  );
}
