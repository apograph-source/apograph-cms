import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useInsightsRange } from '@orthacms/insights-admin';
import { httpMediaInsightsGateway } from '../../infrastructure/httpMediaInsightsGateway';

/** Permission every media Insights read is gated on. */
const MEDIA_READ = 'media:read';

/**
 * Query keys for the media Insights caches.
 *
 * Workspace-scoped for the same reason as every other media key: the workspace
 * only reaches the server as an ambient header, which is never sent on a cache
 * hit — so without the id in the key, switching workspaces would serve the
 * previous one's numbers and never refetch.
 */
export const mediaInsightsKeys = {
    all: (workspaceId: string) => ['media-insights', workspaceId] as const,
    storage: (workspaceId: string) =>
        ['media-insights', workspaceId, 'storage'] as const,
    uploads: (workspaceId: string, days: number) =>
        ['media-insights', workspaceId, 'uploads', days] as const,
    alt: (workspaceId: string) =>
        ['media-insights', workspaceId, 'alt'] as const
};

/**
 * Loads assets and bytes per media kind.
 *
 * Both the Overview storage tile and the full storage widget call this; one
 * query key means one request serves both while each keeps its own state.
 */
export function useMediaStorage() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(MEDIA_READ);

    return useQuery({
        queryKey: mediaInsightsKeys.storage(workspace.id),
        queryFn: () => httpMediaInsightsGateway.storage(),
        staleTime: STALE_TIME.Standard,
        // One retry, not TanStack's default three. A widget that cannot load
        // must SAY so, and three attempts with exponential backoff leave it
        // sitting on a skeleton for about seven seconds first — on a page whose
        // whole premise is that one failing card degrades alone, that reads as
        // a hang rather than a failure. One retry still covers a transient blip.
        retry: 1,
        enabled: canRead
    });
}

/** Loads assets uploaded per time bucket across the selected range. */
export function useMediaUploads() {
    const workspace = useCurrentWorkspace();
    const { days } = useInsightsRange();
    const canRead = useHasPermission(MEDIA_READ);

    return useQuery({
        queryKey: mediaInsightsKeys.uploads(workspace.id, days),
        queryFn: () => httpMediaInsightsGateway.uploads(days),
        staleTime: STALE_TIME.Standard,
        // One retry, not TanStack's default three. A widget that cannot load
        // must SAY so, and three attempts with exponential backoff leave it
        // sitting on a skeleton for about seven seconds first — on a page whose
        // whole premise is that one failing card degrades alone, that reads as
        // a hang rather than a failure. One retry still covers a transient blip.
        retry: 1,
        enabled: canRead
    });
}

/**
 * Loads alt-text coverage across the workspace's images.
 *
 * Takes no range: accessibility debt is a standing total, not something that
 * happened in the last 30 days, and windowing it would make the number shrink
 * whenever someone narrowed the range.
 */
export function useMediaAltCoverage() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(MEDIA_READ);

    return useQuery({
        queryKey: mediaInsightsKeys.alt(workspace.id),
        queryFn: () => httpMediaInsightsGateway.altCoverage(),
        staleTime: STALE_TIME.Standard,
        // One retry, not TanStack's default three. A widget that cannot load
        // must SAY so, and three attempts with exponential backoff leave it
        // sitting on a skeleton for about seven seconds first — on a page whose
        // whole premise is that one failing card degrades alone, that reads as
        // a hang rather than a failure. One retry still covers a transient blip.
        retry: 1,
        enabled: canRead
    });
}
