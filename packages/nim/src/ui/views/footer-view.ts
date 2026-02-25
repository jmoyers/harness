import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import { nimVersion } from '../../contracts/config.ts';
import { TH } from '../theme.ts';

export class FooterView extends Widget {
  constructor() {
    super('footer');
    this.height = 1;
  }

  render(buf: ClippedCellBuffer): void {
    buf.fillRow(0, TH.footerText);

    const dir = process.cwd().replace(process.env.HOME ?? '', '~');
    buf.drawText(1, 0, dir, TH.footerText);

    const status = `nim ${nimVersion}`;
    buf.drawText(Math.max(1, buf.cols - status.length - 1), 0, status, TH.footerText);

    const hints: ReadonlyArray<readonly [string, string]> = [['ctrl+c', 'quit']];
    const hintsWidth = hints.reduce((sum, [key, label]) => sum + key.length + label.length + 3, 0);
    let x = Math.max(1, Math.floor((buf.cols - hintsWidth) / 2));
    for (const [key, label] of hints) {
      buf.drawText(x, 0, key, TH.footerKey);
      x += key.length + 1;
      buf.drawText(x, 0, label, TH.footerText);
      x += label.length + 2;
    }
  }
}
