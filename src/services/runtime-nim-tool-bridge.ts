import type { NimToolDefinition, NimToolPolicy } from '../../packages/nim-core/src/index.ts';

const RUNTIME_NIM_READ_TOOLS: readonly NimToolDefinition[] = [
  {
    name: 'directory.list',
    description: 'List directories known to the current workspace.',
  },
  {
    name: 'repository.list',
    description: 'List repositories known to the current workspace.',
  },
  {
    name: 'task.list',
    description: 'List tasks known to the current workspace.',
  },
  {
    name: 'session.list',
    description: 'List active and historical sessions in the current workspace.',
  },
];

const RUNTIME_NIM_READ_POLICY: NimToolPolicy = {
  hash: 'nim-control-plane-read-v1',
  allow: RUNTIME_NIM_READ_TOOLS.map((tool) => tool.name),
  deny: [],
};

export interface RuntimeNimToolBridgeOptions {
  readonly listDirectories: () => Promise<readonly unknown[]>;
  readonly listRepositories: () => Promise<readonly unknown[]>;
  readonly listTasks: (limit: number) => Promise<readonly unknown[]>;
  readonly listSessions: () => Promise<readonly unknown[]>;
  readonly taskListLimit?: number;
}

export interface RuntimeNimToolBridgeInvokeInput {
  readonly toolName: string;
  readonly argumentsText: string;
}

export interface RuntimeNimToolRuntime {
  registerTools(tools: readonly NimToolDefinition[]): void;
  setToolPolicy(policy: NimToolPolicy): void;
}

export class RuntimeNimToolBridge {
  private readonly taskListLimit: number;

  constructor(private readonly options: RuntimeNimToolBridgeOptions) {
    this.taskListLimit = Math.max(1, options.taskListLimit ?? 100);
  }

  registerWithRuntime(runtime: RuntimeNimToolRuntime): void {
    runtime.registerTools(RUNTIME_NIM_READ_TOOLS);
    runtime.setToolPolicy(RUNTIME_NIM_READ_POLICY);
  }

  async invoke(input: RuntimeNimToolBridgeInvokeInput): Promise<unknown> {
    if (input.toolName === 'directory.list') {
      const directories = await this.options.listDirectories();
      return {
        count: directories.length,
        directories,
      };
    }
    if (input.toolName === 'repository.list') {
      const repositories = await this.options.listRepositories();
      return {
        count: repositories.length,
        repositories,
      };
    }
    if (input.toolName === 'task.list') {
      const limit = resolvePositiveLimit(input.argumentsText, this.taskListLimit);
      const tasks = await this.options.listTasks(limit);
      return {
        count: tasks.length,
        limit,
        tasks,
      };
    }
    if (input.toolName === 'session.list') {
      const sessions = await this.options.listSessions();
      return {
        count: sessions.length,
        sessions,
      };
    }
    throw new Error(`unsupported nim tool: ${input.toolName}`);
  }
}

function resolvePositiveLimit(argumentsText: string, fallback: number): number {
  const trimmed = argumentsText.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid task.list limit: ${trimmed}`);
  }
  return parsed;
}
