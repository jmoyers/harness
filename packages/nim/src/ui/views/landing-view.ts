import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import { UiKit } from '../../../../harness-ui/src/kit.ts';
import type { AgentMode } from '../../contracts/types.ts';
import { LANDING_TIPS } from '../../contracts/config.ts';
import { drawCentered, layout } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

const UI_KIT = new UiKit();

export class LandingView extends Widget {
  mode = reactive<AgentMode>('build');
  apiKeyRequired = reactive(false);
  apiKeyDisplayName = reactive('Anthropic API Key');
  apiKeyEnvVar = reactive('ANTHROPIC_API_KEY');
  apiKeyEntryActive = reactive(false);

  constructor() {
    super('landing');
    this.manualChildRendering = true;
  }

  private renderComposer(
    buf: ClippedCellBuffer,
    promptY: number,
  ): {
    readonly boxX: number;
    readonly boxWidth: number;
    readonly composerHeight: number;
  } {
    const boxWidth = Math.min(72, Math.max(24, buf.cols - 8));
    const boxX = Math.max(1, Math.floor((buf.cols - boxWidth) / 2));
    const composerHeight = 3;

    for (const child of this.children) {
      if (!child.visible) {
        continue;
      }
      const composerBuf = buf.clip({
        x: boxX,
        y: promptY,
        width: boxWidth,
        height: composerHeight,
      });
      child.render(composerBuf);
    }
    return {
      boxX,
      boxWidth,
      composerHeight,
    };
  }

  private renderDefaultLanding(buf: ClippedCellBuffer): void {
    const logoY = Math.max(0, Math.floor(buf.rows / 2) - 5);
    drawCentered(buf, logoY, 'nim', TH.strong);
    drawCentered(buf, logoY + 1, 'harness coordination agent', TH.muted);

    const promptY = logoY + 3;
    const composerLayout = this.renderComposer(buf, promptY);

    const hintY = promptY + composerLayout.composerHeight;
    const hints = ['ctrl+t variants', 'tab agents', 'ctrl+p commands'];
    let cursorX = Math.max(
      composerLayout.boxX + 2,
      composerLayout.boxX + composerLayout.boxWidth - hints.join('  ').length - 2,
    );
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

  private renderApiKeySetup(buf: ClippedCellBuffer): void {
    const headerY = Math.max(0, Math.floor(buf.rows / 2) - 8);
    drawCentered(buf, headerY, 'nim', TH.strong);
    drawCentered(buf, headerY + 1, 'connect your provider', TH.muted);
    drawCentered(buf, headerY + 3, `${this.apiKeyDisplayName} required`, TH.panelAccent);
    const body = layout.wrap(
      `${this.apiKeyDisplayName} is required before nim can start a session.`,
      Math.max(24, buf.cols - 12),
    );
    for (let index = 0; index < body.length; index += 1) {
      drawCentered(buf, headerY + 5 + index, body[index]!, TH.text);
    }
    const cta = this.apiKeyEntryActive
      ? UI_KIT.formatButton({
          label: `Paste ${this.apiKeyEnvVar}`,
          prefixIcon: '>',
        })
      : UI_KIT.formatButton({
          label: `Add ${this.apiKeyDisplayName}`,
          prefixIcon: '+',
        });
    drawCentered(buf, headerY + 7 + body.length, cta, TH.panelAccent);
    drawCentered(buf, headerY + 8 + body.length, 'Press Enter to save key', TH.tipText);
    drawCentered(buf, headerY + 9 + body.length, 'Ctrl+P -> Set Anthropic API Key', TH.muted);
    drawCentered(
      buf,
      headerY + 11 + body.length,
      `Saved in ~/.harness/secrets.env as ${this.apiKeyEnvVar}`,
      TH.muted,
    );

    const promptY = Math.min(buf.rows - 4, headerY + 13 + body.length);
    this.renderComposer(buf, promptY);
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.bg);
    }
    if (this.apiKeyRequired) {
      this.renderApiKeySetup(buf);
      return;
    }
    this.renderDefaultLanding(buf);
  }
}
