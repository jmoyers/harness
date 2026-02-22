import type { StreamTelemetrySummary } from '../../stream-protocol.ts';
import { BaseAgentStatusReducer } from '../reducer-base.ts';

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export class ClaudeStatusReducer extends BaseAgentStatusReducer {
  readonly agentType = 'claude';

  constructor() {
    super();
  }

  protected override projectFromTelemetry(
    telemetry: StreamTelemetrySummary,
  ): { text: string | null; activityHint: 'needs-action' | 'working' | 'idle' | null } | null {
    const eventName = normalize(telemetry.eventName);
    if (eventName === 'claude.userpromptsubmit' || eventName === 'claude.pretooluse') {
      return {
        text: 'active',
        activityHint: 'working',
      };
    }
    if (
      eventName === 'claude.stop' ||
      eventName === 'claude.subagentstop' ||
      eventName === 'claude.sessionend'
    ) {
      return {
        text: 'inactive',
        activityHint: 'idle',
      };
    }
    return null;
  }
}
