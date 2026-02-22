import type { StreamTelemetrySummary } from '../../stream-protocol.ts';
import { BaseAgentStatusReducer } from '../reducer-base.ts';

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export class CursorStatusReducer extends BaseAgentStatusReducer {
  readonly agentType = 'cursor';

  constructor() {
    super();
  }

  protected override projectFromTelemetry(
    telemetry: StreamTelemetrySummary,
  ): { text: string | null; activityHint: 'needs-action' | 'working' | 'idle' | null } | null {
    const eventName = normalize(telemetry.eventName);
    if (
      eventName === 'cursor.beforesubmitprompt' ||
      eventName === 'cursor.beforeshellexecution' ||
      eventName === 'cursor.beforemcptool'
    ) {
      return {
        text: 'active',
        activityHint: 'working',
      };
    }
    if (eventName === 'cursor.stop' || eventName === 'cursor.sessionend') {
      return {
        text: 'inactive',
        activityHint: 'idle',
      };
    }
    return null;
  }
}
