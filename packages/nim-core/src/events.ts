import { z } from 'zod';

export const nimEventSourceSchema = z.enum([
  'provider',
  'tool',
  'memory',
  'skill',
  'soul',
  'system',
]);

export const nimEventStateSchema = z.enum(['thinking', 'tool-calling', 'responding', 'idle']);

export const nimEventEnvelopeSchema = z
  .object({
    event_id: z.string().min(1),
    event_seq: z.number().int().nonnegative(),
    ts: z.string().min(1),
    tenant_id: z.string().min(1),
    user_id: z.string().min(1),
    workspace_id: z.string().min(1),
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    turn_id: z.string().min(1),
    step_id: z.string().min(1),
    tool_call_id: z.string().min(1).optional(),
    source: nimEventSourceSchema,
    type: z.string().min(1),
    payload_ref: z.string().min(1).optional(),
    payload_hash: z.string().min(1),
    idempotency_key: z.string().min(1),
    lane: z.string().min(1),
    queue_id: z.string().min(1).optional(),
    queue_position: z.number().int().nonnegative().optional(),
    steer_strategy: z.enum(['inject', 'interrupt-and-restart']).optional(),
    strategy_phase: z.string().min(1).optional(),
    provider_event_index: z.number().int().nonnegative().optional(),
    state: nimEventStateSchema.optional(),
    policy_hash: z.string().min(1),
    skills_snapshot_version: z.number().int().nonnegative().optional(),
    soul_hash: z.string().min(1).optional(),
    trace_id: z.string().min(1),
    span_id: z.string().min(1),
    parent_span_id: z.string().min(1).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type NimEventEnvelope = z.infer<typeof nimEventEnvelopeSchema>;

export function parseNimEventEnvelope(input: unknown): NimEventEnvelope {
  return nimEventEnvelopeSchema.parse(input);
}
