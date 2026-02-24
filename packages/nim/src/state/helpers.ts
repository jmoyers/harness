import { TextLayoutEngine } from '../../../harness-ui/src/text-layout.ts';
import type { ClippedCellBuffer } from '../../../harness-ui/src/core/cell-buffer.ts';
import type { CellStyle } from '../../../harness-ui/src/core/color.ts';
import type { AgentMode, ChatMsg, FileChange } from '../contracts/types.ts';
import { TH } from '../ui/theme.ts';

export const layout = new TextLayoutEngine();

export function prettyModel(model: string): string {
  const parts = model.split('/');
  return parts.length > 1 ? parts[1]! : model;
}

export function modeTitle(mode: AgentMode): string {
  return mode === 'build' ? 'Build' : 'Plan';
}

export function modeStyle(mode: AgentMode): CellStyle {
  return mode === 'build' ? TH.modeBuild : TH.modePlan;
}

export function drawCentered(buf: ClippedCellBuffer, y: number, text: string, style: CellStyle): void {
  const x = Math.max(0, Math.floor((buf.cols - text.length) / 2));
  buf.drawText(x, y, text, style);
}

export function padRight(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

export function progressBar(width: number, percentage: number): string {
  const safeWidth = Math.max(4, width);
  const inner = safeWidth - 2;
  const filled = Math.max(0, Math.min(inner, Math.round((percentage / 100) * inner)));
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, inner - filled))}]`;
}

export function approxTokenCount(messages: readonly ChatMsg[]): number {
  const transcript = messages.map((message) => message.text).join('\n');
  const rough = Math.ceil(transcript.length / 4);
  return Math.max(0, rough);
}

function updateFileChanges(map: Map<string, FileChange>, text: string): void {
  const regex = /([\w./-]+\.[A-Za-z0-9_-]+)\s*\+(\d+)\s*-(\d+)/g;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    const file = match[1]!;
    const additions = Number.parseInt(match[2]!, 10);
    const deletions = Number.parseInt(match[3]!, 10);
    const previous = map.get(file);
    map.set(file, {
      file,
      additions: Math.max(previous?.additions ?? 0, Number.isFinite(additions) ? additions : 0),
      deletions: Math.max(previous?.deletions ?? 0, Number.isFinite(deletions) ? deletions : 0),
    });
    match = regex.exec(text);
  }
}

export function collectFileChanges(messages: readonly ChatMsg[]): FileChange[] {
  const map = new Map<string, FileChange>();
  for (const message of messages) {
    updateFileChanges(map, message.text);
    for (const tool of message.tools) {
      if (tool.result !== undefined) updateFileChanges(map, tool.result);
      if (tool.args.length > 0) updateFileChanges(map, tool.args);
    }
  }
  return [...map.values()].slice(0, 8);
}
