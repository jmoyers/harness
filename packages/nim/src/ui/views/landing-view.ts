import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import type { AgentMode } from '../../contracts/types.ts';
import { LANDING_TIPS } from '../../contracts/config.ts';
import { drawCentered } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

export class LandingView extends Widget {
  mode = reactive<AgentMode>('build');

  constructor() {
    super('landing');
    this.manualChildRendering = true;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.bg);
    }

    const logoY = Math.max(0, Math.floor(buf.rows / 2) - 5);
    drawCentered(buf, logoY, 'nim', TH.strong);
    drawCentered(buf, logoY + 1, 'harness coordination agent', TH.muted);

    const promptY = logoY + 3;
    const boxWidth = Math.min(72, Math.max(24, buf.cols - 8));
    const boxX = Math.max(1, Math.floor((buf.cols - boxWidth) / 2));
    const composerHeight = 3;

    for (const child of this.children) {
      if (!child.visible) {
        continue;
      }
      const composerBuf = buf.clip({ x: boxX, y: promptY, width: boxWidth, height: composerHeight });
      child.render(composerBuf);
    }

    const hintY = promptY + composerHeight;
    const hints = ['ctrl+t variants', 'tab agents', 'ctrl+p commands'];
    let cursorX = Math.max(boxX + 2, boxX + boxWidth - hints.join('  ').length - 2);
    for (const hint of hints) {
      const [key, label] = hint.split(' ');
      buf.drawText(cursorX, hintY, key!, TH.muted);
      cursorX += key!.length + 1;
      buf.drawText(cursorX, hintY, label!, TH.tipText);
      cursorX += label!.length + 2;
    }

    const tipIndex = Math.floor(Date.now() / 30000) % LANDING_TIPS.length;
    const tip = LANDING_TIPS[tipIndex]!;
    const tipStart = Math.max(0, Math.floor((buf.cols - (tip.length + 6)) / 2));
    buf.drawText(tipStart, hintY + 2, '●', TH.tipDot);
    buf.drawText(tipStart + 2, hintY + 2, 'Tip', TH.tipLabel);
    buf.drawText(tipStart + 6, hintY + 2, tip, TH.tipText);
  }
}
