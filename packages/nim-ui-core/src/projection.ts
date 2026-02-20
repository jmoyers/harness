import type { NimEventEnvelope } from '../../nim-core/src/events.ts';
import type { NimUiEvent } from '../../nim-core/src/contracts.ts';

export type NimUiMode = 'debug' | 'seamless';

function toStateEvent(state: 'thinking' | 'tool-calling' | 'responding' | 'idle'): NimUiEvent {
  return {
    type: 'assistant.state',
    state,
  };
}

export function projectEventToUiEvents(
  event: NimEventEnvelope,
  mode: NimUiMode,
): readonly NimUiEvent[] {
  if (event.type === 'assistant.state.changed' && event.state !== undefined) {
    return [toStateEvent(event.state)];
  }

  if (event.type === 'provider.thinking.started') {
    return [toStateEvent('thinking')];
  }
  if (event.type === 'provider.thinking.completed') {
    return [toStateEvent('responding')];
  }

  if (event.type === 'assistant.output.delta') {
    const text = typeof event.data?.['text'] === 'string' ? event.data['text'] : '';
    if (text.length === 0) {
      return [];
    }
    return [{ type: 'assistant.text.delta', text }];
  }

  if (event.type === 'assistant.output.message') {
    const text = typeof event.data?.['text'] === 'string' ? event.data['text'] : '';
    if (text.length === 0) {
      return [];
    }
    return [{ type: 'assistant.text.message', text }];
  }

  if (event.type === 'tool.call.started') {
    if (mode === 'seamless') {
      return [toStateEvent('tool-calling')];
    }
    const toolName = typeof event.data?.['toolName'] === 'string' ? event.data['toolName'] : 'tool';
    return [
      {
        type: 'tool.activity',
        toolCallId: event.tool_call_id ?? `${event.step_id}:unknown`,
        toolName,
        phase: 'start',
      },
    ];
  }

  if (event.type === 'tool.call.completed') {
    if (mode === 'seamless') {
      return [toStateEvent('responding')];
    }
    const toolName = typeof event.data?.['toolName'] === 'string' ? event.data['toolName'] : 'tool';
    return [
      {
        type: 'tool.activity',
        toolCallId: event.tool_call_id ?? `${event.step_id}:unknown`,
        toolName,
        phase: 'end',
      },
    ];
  }

  if (event.type === 'tool.call.failed') {
    const toolName = typeof event.data?.['toolName'] === 'string' ? event.data['toolName'] : 'tool';
    return [
      {
        type: 'tool.activity',
        toolCallId: event.tool_call_id ?? `${event.step_id}:unknown`,
        toolName,
        phase: 'error',
      },
    ];
  }

  return [];
}
