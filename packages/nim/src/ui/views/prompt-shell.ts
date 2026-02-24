import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import type { AgentMode } from '../../contracts/types.ts';
import { modeStyle } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

export class PromptShell extends Widget {
  mode = reactive<AgentMode>('build');
  busy = reactive(false);

  constructor() {
    super('prompt-shell');
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.panel);
    }

    const accent = modeStyle(this.mode);
    const firstInputRow = Math.min(buf.rows - 1, 1);
    const lastInputRow = Math.max(firstInputRow, buf.rows - 2);
    for (let row = firstInputRow; row <= lastInputRow; row += 1) {
      buf.drawText(0, row, '┃', accent);
    }
    buf.drawText(0, Math.max(0, buf.rows - 1), '╹', accent);

    if (this.busy) {
      const status = '⣾ nim is thinking...';
      buf.drawText(Math.max(2, buf.cols - status.length - 2), Math.max(0, buf.rows - 1), status, TH.panelMuted);
      return;
    }

    const hints = ['ctrl+t variants', 'tab agents', 'ctrl+p commands'];
    let x = Math.max(2, buf.cols - (hints.join('  ').length + 2));
    for (const hint of hints) {
      const [key, label] = hint.split(' ');
      buf.drawText(x, Math.max(0, buf.rows - 1), key!, TH.panelKey);
      x += key!.length + 1;
      buf.drawText(x, Math.max(0, buf.rows - 1), label!, TH.panelMuted);
      x += label!.length + 2;
    }
  }
}
