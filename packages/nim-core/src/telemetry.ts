import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NimTelemetrySink } from './contracts.ts';
import { parseNimEventEnvelope, type NimEventEnvelope } from './events.ts';

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

export function readNimJsonlTelemetry(filePath: string): NimEventEnvelope[] {
  const content = readFileSync(filePath, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  const lines = content.split('\n');
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`invalid Nim telemetry JSONL at line ${String(index + 1)}`);
    }
    try {
      return parseNimEventEnvelope(parsed);
    } catch {
      throw new Error(`invalid Nim telemetry event envelope at line ${String(index + 1)}`);
    }
  });
}
