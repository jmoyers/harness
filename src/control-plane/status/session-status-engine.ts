import type { StreamSessionStatusModel, StreamTelemetrySummary } from '../stream-protocol.ts';
import {
  AGENT_STATUS_REDUCER_RUNTIME_TOKEN,
  type AgentStatusProjectionInput,
  type AgentStatusReducer,
} from './agent-status-reducer.ts';
import { ClaudeStatusReducer } from './reducers/claude-status-reducer.ts';
import { CodexStatusReducer } from './reducers/codex-status-reducer.ts';
import { CritiqueStatusReducer } from './reducers/critique-status-reducer.ts';
import { CursorStatusReducer } from './reducers/cursor-status-reducer.ts';
import { TerminalStatusReducer } from './reducers/terminal-status-reducer.ts';

type SupportedAgentType = 'codex' | 'claude' | 'cursor' | 'terminal' | 'critique' | 'nim';

const reducers: Record<SupportedAgentType, AgentStatusReducer> = {
  codex: new CodexStatusReducer(),
  claude: new ClaudeStatusReducer(),
  cursor: new CursorStatusReducer(),
  terminal: new TerminalStatusReducer(),
  critique: new CritiqueStatusReducer(),
  nim: new CodexStatusReducer(),
};

void AGENT_STATUS_REDUCER_RUNTIME_TOKEN;

function normalizeAgentType(value: string): SupportedAgentType {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'codex' ||
    normalized === 'claude' ||
    normalized === 'cursor' ||
    normalized === 'terminal' ||
    normalized === 'critique' ||
    normalized === 'nim'
  ) {
    return normalized;
  }
  return 'terminal';
}

interface SessionStatusEngineInput {
  readonly agentType: string;
  readonly runtimeStatus: AgentStatusProjectionInput['runtimeStatus'];
  readonly attentionReason: string | null;
  readonly telemetry: StreamTelemetrySummary | null;
  readonly observedAt: string;
  readonly previous: StreamSessionStatusModel | null;
}

export class SessionStatusEngine {
  private readonly reducers: Record<SupportedAgentType, AgentStatusReducer>;

  constructor(reducersByType: Record<SupportedAgentType, AgentStatusReducer> = reducers) {
    this.reducers = reducersByType;
  }

  project(input: SessionStatusEngineInput): StreamSessionStatusModel | null {
    const normalizedAgentType = normalizeAgentType(input.agentType);
    const reducer = this.reducers[normalizedAgentType];
    const telemetry = input.telemetry;
    return reducer.project({
      runtimeStatus: input.runtimeStatus,
      attentionReason: input.attentionReason,
      telemetry:
        telemetry === null
          ? null
          : {
              source: telemetry.source,
              eventName: telemetry.eventName,
              severity: telemetry.severity,
              summary: telemetry.summary,
              observedAt: telemetry.observedAt,
            },
      observedAt: input.observedAt,
      previous: input.previous,
    });
  }
}
