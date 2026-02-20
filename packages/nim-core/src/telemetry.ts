import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NimTelemetrySink } from './contracts.ts';
import type { NimEventEnvelope } from './events.ts';

export type NimJsonlTelemetrySinkInput = {
  readonly filePath: string;
  readonly mode?: 'append' | 'truncate';
};

export class NimJsonlTelemetrySink implements NimTelemetrySink {
  public readonly name: string;
  private readonly filePath: string;

  public constructor(input: NimJsonlTelemetrySinkInput) {
    this.filePath = input.filePath;
    this.name = `jsonl:${this.filePath}`;
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (input.mode !== 'append') {
      writeFileSync(this.filePath, '', 'utf8');
    }
  }

  public record(event: NimEventEnvelope): void {
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
