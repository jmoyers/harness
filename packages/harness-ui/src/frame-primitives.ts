export interface RenderCursorStyle {
  readonly shape: 'block' | 'underline' | 'bar';
  readonly blinking: boolean;
}

interface DiffRenderedRowsResult {
  readonly output: string;
  readonly nextRows: readonly string[];
  readonly changedRows: readonly number[];
}

export function diffRenderedRows(
  currentRows: readonly string[],
  previousRows: readonly string[],
): DiffRenderedRowsResult {
  const changedRows: number[] = [];
  let output = '';
  const rowCount = Math.max(currentRows.length, previousRows.length);
  const nextRows: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const current = currentRows[row] ?? '';
    const previous = previousRows[row] ?? '';
    nextRows.push(current);
    if (current === previous) {
      continue;
    }
    changedRows.push(row);
    output += `\u001b[${String(row + 1)};1H\u001b[2K${current}`;
  }
  return {
    output,
    nextRows,
    changedRows,
  };
}

export function cursorStyleToDecscusr(style: RenderCursorStyle): string {
  if (style.shape === 'block') {
    return style.blinking ? '\u001b[1 q' : '\u001b[2 q';
  }
  if (style.shape === 'underline') {
    return style.blinking ? '\u001b[3 q' : '\u001b[4 q';
  }
  return style.blinking ? '\u001b[5 q' : '\u001b[6 q';
}

export function cursorStyleEqual(
  left: RenderCursorStyle | null,
  right: RenderCursorStyle,
): boolean {
  if (left === null) {
    return false;
  }
  return left.shape === right.shape && left.blinking === right.blinking;
}

type ScanResult =
  | {
      readonly valid: true;
    }
  | {
      readonly valid: false;
      readonly reason: string;
    };

function scanAnsiText(text: string): ScanResult {
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index)!;
    const char = String.fromCodePoint(code);
    const width = code > 0xffff ? 2 : 1;
    if (char !== '\u001b') {
      index += width;
      continue;
    }

    const next = text[index + 1];
    if (next === undefined) {
      return {
        valid: false,
        reason: 'dangling ESC at end of row',
      };
    }

    if (next === '[') {
      let csiIndex = index + 2;
      let foundFinal = false;
      while (csiIndex < text.length) {
        const csiCode = text.codePointAt(csiIndex)!;
        if (csiCode >= 0x40 && csiCode <= 0x7e) {
          foundFinal = true;
          csiIndex += 1;
          break;
        }
        if (csiCode < 0x20 || csiCode > 0x3f) {
          return {
            valid: false,
            reason: `invalid CSI byte 0x${csiCode.toString(16)}`,
          };
        }
        csiIndex += 1;
      }
      if (!foundFinal) {
        return {
          valid: false,
          reason: 'unterminated CSI sequence',
        };
      }
      index = csiIndex;
      continue;
    }

    if (next === ']') {
      let oscIndex = index + 2;
      let terminated = false;
      while (oscIndex < text.length) {
        const oscCode = text.codePointAt(oscIndex)!;
        if (oscCode === 0x07) {
          terminated = true;
          oscIndex += 1;
          break;
        }
        if (oscCode === 0x1b && text[oscIndex + 1] === '\\') {
          terminated = true;
          oscIndex += 2;
          break;
        }
        oscIndex += oscCode > 0xffff ? 2 : 1;
      }
      if (!terminated) {
        return {
          valid: false,
          reason: 'unterminated OSC sequence',
        };
      }
      index = oscIndex;
      continue;
    }

    index += 2;
  }

  return {
    valid: true,
  };
}

export function findAnsiIntegrityIssues(rows: readonly string[]): readonly string[] {
  const issues: string[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? '';
    const result = scanAnsiText(row);
    if (!result.valid) {
      issues.push(`row ${String(rowIndex + 1)}: ${result.reason}`);
    }
  }
  return issues;
}
