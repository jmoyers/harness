type AgentToolsStatusCommand = {
  type: 'agent.tools.status';
  agentTypes?: string[];
};

type CommandMenuStateLike = {
  readonly scope: string;
} | null;

export type InstallableAgentType = 'codex' | 'claude' | 'cursor' | 'critique';

interface AgentToolStatusRecord {
  readonly agentType: InstallableAgentType;
  readonly launchCommand: string;
  readonly available: boolean;
  readonly installCommand: string | null;
}

const INSTALLABLE_AGENT_TYPES = ['codex', 'claude', 'cursor', 'critique'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseAgentToolStatusList(result: unknown): AgentToolStatusRecord[] {
  const parsed = asRecord(result);
  if (parsed === null) {
    return [];
  }
  const tools = parsed['tools'];
  if (!Array.isArray(tools)) {
    return [];
  }
  const statuses: AgentToolStatusRecord[] = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    if (record === null) {
      continue;
    }
    const agentTypeRaw = record['agentType'];
    if (
      agentTypeRaw !== 'codex' &&
      agentTypeRaw !== 'claude' &&
      agentTypeRaw !== 'cursor' &&
      agentTypeRaw !== 'critique'
    ) {
      continue;
    }
    const launchCommandRaw = record['launchCommand'];
    const availableRaw = record['available'];
    const installCommandRaw = record['installCommand'];
    if (typeof launchCommandRaw !== 'string' || typeof availableRaw !== 'boolean') {
      continue;
    }
    if (installCommandRaw !== null && typeof installCommandRaw !== 'string') {
      continue;
    }
    statuses.push({
      agentType: agentTypeRaw,
      launchCommand: launchCommandRaw,
      available: availableRaw,
      installCommand: installCommandRaw,
    });
  }
  return statuses;
}

interface RuntimeCommandMenuAgentToolsOptions {
  readonly sendCommand: (command: AgentToolsStatusCommand) => Promise<Record<string, unknown>>;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly getCommandMenu: () => CommandMenuStateLike;
  readonly markDirty: () => void;
}

export class RuntimeCommandMenuAgentToolsCache {
  private readonly statusByAgent = new Map<InstallableAgentType, AgentToolStatusRecord>();

  constructor(private readonly options: RuntimeCommandMenuAgentToolsOptions) {}

  refresh(): void {
    this.options.queueControlPlaneOp(async () => {
      let parsedStatuses: AgentToolStatusRecord[] = [];
      try {
        const result = await this.options.sendCommand({
          type: 'agent.tools.status',
          agentTypes: [...INSTALLABLE_AGENT_TYPES],
        });
        parsedStatuses = parseAgentToolStatusList(result);
      } catch {
        return;
      }
      const nextByAgent = new Map<InstallableAgentType, AgentToolStatusRecord>();
      for (const status of parsedStatuses) {
        nextByAgent.set(status.agentType, status);
      }
      let changed = nextByAgent.size !== this.statusByAgent.size;
      for (const [agentType, nextStatus] of nextByAgent) {
        const previous = this.statusByAgent.get(agentType);
        if (
          previous === undefined ||
          previous.launchCommand !== nextStatus.launchCommand ||
          previous.available !== nextStatus.available ||
          previous.installCommand !== nextStatus.installCommand
        ) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
      this.statusByAgent.clear();
      for (const [agentType, status] of nextByAgent) {
        this.statusByAgent.set(agentType, status);
      }
      if (this.options.getCommandMenu() !== null) {
        this.options.markDirty();
      }
    }, 'command-menu-agent-tools-status');
  }

  statusForAgent(agentType: InstallableAgentType): AgentToolStatusRecord | null {
    return this.statusByAgent.get(agentType) ?? null;
  }
}
