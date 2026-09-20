import type { ToolCallEvent } from '@orthacms/copilot-domain';
import type { ToolCallDelta } from './types';

/** An in-flight tool call, assembled from `arguments` fragments. */
interface PartialToolCall {
    id?: string;
    name?: string;
    args: string;
}

/** Collects tool-call fragments across chunks and emits them once complete. */
export interface ToolCallAccumulator {
    /** Folds one chunk's `tool_calls` deltas into the pending set. */
    add(deltas: readonly ToolCallDelta[]): void;
    /**
     * The finished calls, in `index` order, arguments parsed. Called only once
     * the stream ends — a call must reach the engine whole, never as
     * fragments.
     */
    drain(): ToolCallEvent[];
}

/**
 * Parses a tool call's accumulated arguments. A model that emits malformed
 * JSON gets an empty object rather than crashing the run: the engine then
 * fails schema validation and returns a tool error the model can recover from,
 * which is a far better outcome than a dead stream.
 */
export function parseArgs(args: string): unknown {
    if (!args.trim()) {
        return {};
    }
    try {
        return JSON.parse(args);
    } catch {
        return {};
    }
}

/**
 * Creates an accumulator.
 *
 * The wire format streams a tool call as fragments keyed by `index`: the first
 * fragment usually carries `id` and `name`, later ones append to `arguments`.
 * Parallel calls interleave, so the index is the only thing tying a fragment
 * to its call.
 */
export function createToolCallAccumulator(): ToolCallAccumulator {
    const pending = new Map<number, PartialToolCall>();

    return {
        add(deltas: readonly ToolCallDelta[]): void {
            for (const delta of deltas) {
                const existing = pending.get(delta.index) ?? { args: '' };
                pending.set(delta.index, {
                    id: delta.id ?? existing.id,
                    name: delta.function?.name ?? existing.name,
                    args: existing.args + (delta.function?.arguments ?? '')
                });
            }
        },

        drain(): ToolCallEvent[] {
            return [...pending]
                .sort(([left], [right]) => left - right)
                .flatMap(([index, call]) =>
                    // A fragment set that never carried a name is not a call
                    // we can dispatch; dropping it beats inventing a name.
                    call.name
                        ? [
                              {
                                  type: 'tool-call' as const,
                                  id: call.id ?? `call-${index}`,
                                  name: call.name,
                                  input: parseArgs(call.args)
                              }
                          ]
                        : []
                );
        }
    };
}
