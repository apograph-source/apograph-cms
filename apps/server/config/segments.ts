/** Reader entitlements — where a reader's tags come from. */
import type { SegmentsPluginConfig } from '@orthacms/segments-server';

/** Reader entitlements — where a reader's tags come from. */
export function segmentsConfig(): SegmentsPluginConfig {
    return {
        // Where a reader's tags come from — the one line this feature needs per
        // install. A resolver receives the request, so a JWT claim, a header the
        // CDN sets, or a lookup against a billing system are all equally
        // reachable:
        //
        //   resolver: {
        //       resolve: async (request) => readTagsFrom(request)
        //   }
        //
        // Left out — as it is here — every reader is anonymous, so unrestricted
        // content serves and restricted content does not. That is a working
        // configuration, and it fails in the safe direction: an audience nobody
        // can be resolved into cannot accidentally be admitted.
    };
}
