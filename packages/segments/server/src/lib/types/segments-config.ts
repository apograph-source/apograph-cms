import type { SegmentResolver } from '@orthacms/segments-domain';

/**
 * What a host configures — one thing.
 *
 * `resolver` says where a reader's tags come from, and it is the only line an
 * operator has to write. Everything else about the feature is data an
 * administrator enters in the admin: the segments themselves, and which of them
 * each entry admits or refuses.
 *
 * **Omitting it is a working configuration**, not a broken one: every reader is
 * then anonymous, so unrestricted content serves and restricted content does
 * not. That is what an installation gets while it is still deciding, and it
 * fails in the safe direction.
 */
export interface SegmentsPluginConfig {
    /**
     * Resolves the reader's tags from the request. Receives the Express
     * request, so a JWT claim, a header the CDN sets, or a lookup against a
     * billing system are all equally reachable.
     */
    resolver?: SegmentResolver<unknown>;
}
