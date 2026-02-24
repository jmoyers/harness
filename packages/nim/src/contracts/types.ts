export type AgentMode = 'build' | 'plan';

export type UiState = 'landing' | 'chat';

export interface ToolCall {
  name: string;
  args: string;
  status: 'pending' | 'done' | 'error';
  result?: string;
}

export interface ChatMsg {
  role: 'user' | 'nim';
  text: string;
  tools: ToolCall[];
  ts: number;
  duration?: number;
}

export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

export interface McpStatus {
  name: string;
  state: 'connected' | 'error' | 'idle';
  detail: string;
}
