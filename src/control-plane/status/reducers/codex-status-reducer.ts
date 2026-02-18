import type { StreamTelemetrySummary } from '../../stream-protocol.ts';
import { BaseAgentStatusReducer } from '../reducer-base.ts';

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export class CodexStatusReducer extends BaseAgentStatusReducer {
  readonly agentType = 'codex';

  constructor() {
    super();
  }

  protected override projectFromTelemetry(telemetry: StreamTelemetrySummary):
    | { text: string | null; phaseHint: 'needs-action' | 'working' | 'idle' | null }
    | null {
    const eventName = normalize(telemetry.eventName);
    const summary = normalize(telemetry.summary);
    if (eventName === 'codex.user_prompt') {
      return {
        text: 'active',
        phaseHint: 'working',
      };
    }
    if (eventName === 'codex.turn.e2e_duration_ms') {
      return {
        text: 'inactive',
        phaseHint: 'idle',
      };
    }
    if (eventName === 'codex.sse_event') {
      if (
        summary.includes('response.created') ||
        summary.includes('response.in_progress') ||
        summary.includes('response.output_text.delta') ||
        summary.includes('response.output_item.added') ||
        summary.includes('response.function_call_arguments.delta')
      ) {
        return {
          text: 'active',
          phaseHint: 'working',
        };
      }
    }
    return null;
  }
}
