import type { ModelCapabilities } from '@orthacms/copilot-domain';
import type { LazyClient } from './client';
import { FALLBACK_CAPABILITIES } from './config';

/**
 * Probes the Models API for one model's live capability record.
 *
 * **Rejects** when the call can't be made, rather than returning the fallback
 * itself: the caller caches this promise, and a fallback that resolved
 * successfully would be cached as if it were an answer — pinning a frontier
 * model to the conservative record for the life of the process over one
 * network blip.
 *
 * The Models API exposes no tool-calling flag; every model it serves supports
 * tool calling, so that stays `true` on both paths.
 */
export async function probeCapabilities(
    client: LazyClient,
    model: string
): Promise<ModelCapabilities> {
    const base = fallbackCapabilities(model);
    const info = await client().models.retrieve(model);
    return {
        model: info.id,
        toolCalling: true,
        streaming: true,
        vision: info.capabilities?.image_input.supported ?? base.vision,
        contextWindow: info.max_input_tokens ?? base.contextWindow,
        maxOutputTokens: info.max_tokens ?? base.maxOutputTokens
    };
}

/**
 * What one model reports when the probe couldn't run — no network, no key, a
 * gateway that doesn't proxy `/v1/models`.
 *
 * Conservative rather than "unsupported": reporting *unknown* as *unsupported*
 * would drop a frontier model into degraded mode over a transient blip, which
 * is a worse failure than being slightly optimistic about a model whose shape
 * we know.
 */
export function fallbackCapabilities(model: string): ModelCapabilities {
    return { ...FALLBACK_CAPABILITIES, model };
}
