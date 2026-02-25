import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import type { FileChange } from '../../contracts/types.ts';
import { nimVersion } from '../../contracts/config.ts';
import { padRight, progressBar } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

export class SidebarView extends Widget {
  sessionLabel = reactive('New session');
  sessionStartedAt = reactive<string | null>(null);
  tokens = reactive(0);
  contextPercent = reactive(0);
  cost = reactive(0);
  filesChanged = reactive<FileChange[]>([]);

  constructor() {
    super('sidebar');
    this.manualChildRendering = true;
  }

  private drawSectionTitle(buf: ClippedCellBuffer, y: number, title: string): number {
    if (y >= buf.rows) {
      return y;
    }
    buf.drawText(1, y, title, TH.sideTitle);
    return y + 1;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.sideBg);
    }

    let y = 1;
    buf.drawText(1, y, this.sessionLabel, TH.sideTitle);
    y += 1;
    if (this.sessionStartedAt !== null) {
      const sessionLine = `- ${this.sessionStartedAt}`;
      buf.drawText(1, y, padRight(sessionLine, Math.max(0, buf.cols - 2)), TH.sideMuted);
      y += 2;
    } else {
      y += 1;
    }

    y = this.drawSectionTitle(buf, y, 'Context');
    if (y < buf.rows) {
      buf.drawText(1, y, `${this.tokens.toLocaleString()} tokens`, TH.sideValue);
      y += 1;
    }
    if (y < buf.rows) {
      buf.drawText(1, y, `${String(this.contextPercent)}% used`, TH.sideMuted);
      y += 1;
    }
    if (y < buf.rows) {
      const bar = progressBar(Math.max(12, buf.cols - 4), this.contextPercent);
      buf.drawText(1, y, bar, TH.sideMuted);
      y += 1;
    }
    if (y < buf.rows) {
      buf.drawText(1, y, `$${this.cost.toFixed(2)} spent`, TH.sideMuted);
      y += 2;
    }

    y = this.drawSectionTitle(buf, y, 'Files Changed');
    if (this.filesChanged.length === 0) {
      if (y < buf.rows) {
        buf.drawText(1, y, 'No files changed yet', TH.sideMuted);
      }
    } else {
      for (const file of this.filesChanged) {
        if (y >= buf.rows) {
          break;
        }
        buf.drawText(1, y, file.file, TH.sideValue);
        if (y + 1 < buf.rows) {
          const delta = `+${String(file.additions)}  -${String(file.deletions)}`;
          buf.drawText(1, y + 1, delta, TH.sideMuted);
        }
        y += 2;
      }
    }

    const versionLine = `nim ${nimVersion}`;
    buf.drawText(
      Math.max(1, buf.cols - versionLine.length - 1),
      Math.max(0, buf.rows - 1),
      versionLine,
      TH.sideMuted,
    );
  }
}
