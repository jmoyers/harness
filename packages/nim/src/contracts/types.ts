export type AgentMode = 'build' | 'plan';

export type UiState = 'landing' | 'chat';

export interface ToolCall {
  id: string;
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
  pending?: boolean;
  state?: 'thinking' | 'tool-calling' | 'responding' | 'idle';
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
