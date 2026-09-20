import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@orthacms/utils-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useInsightsRange } from '@orthacms/insights-admin';
import { CONTENT_READ } from '../../domain/constants';
import { contentInsightsKeys } from '../../infrastructure/contentInsightsKeys';
import { httpContentInsightsGateway } from '../../infrastructure/httpContentInsightsGateway';

/**
 * Loads the headline content counts for the stat tiles.
 *
 * All three content stat widgets call this. They stay **separate widgets** —
 * each renders its own pending and error state — but they share one query key,
 * so TanStack Query dedupes them into a single request. Independent loaders
 * without three round-trips for one aggregate.
 */
export function useContentTotals() {
    const workspace = useCurrentWorkspace();
    const { days } = useInsightsRange();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.totals(workspace.id, days),
        queryFn: () => httpContentInsightsGateway.totals(days),
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
 * Loads published entries bucketed by how long ago they were last edited.
 *
 * Takes no range — the buckets are the time axis, and they are fixed so the
 * answer means the same thing whatever the page's range is set to.
 */
export function useContentStale() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.stale(workspace.id),
        queryFn: () => httpContentInsightsGateway.stale(),
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

/** Loads the draft/published split per content type. A snapshot, not a window. */
export function useContentPipeline() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.pipeline(workspace.id),
        queryFn: () => httpContentInsightsGateway.pipeline(),
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
 * Loads live entries carrying unpublished edits, per type and in total.
 *
 * Takes no range, like `stale`: a pending edit is pending whether it was made
 * this morning or last spring, so a window could only hide part of the backlog.
 */
export function useContentUnshipped() {
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.unshipped(workspace.id),
        queryFn: () => httpContentInsightsGateway.unshipped(),
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

/** Loads entries published per time bucket across the selected range. */
export function useContentVelocity() {
    const workspace = useCurrentWorkspace();
    const { days } = useInsightsRange();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.velocity(workspace.id, days),
        queryFn: () => httpContentInsightsGateway.velocity(days),
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

/** Loads editing activity by weekday and hour across the selected range. */
export function useContentPunchcard() {
    const workspace = useCurrentWorkspace();
    const { days } = useInsightsRange();
    const canRead = useHasPermission(CONTENT_READ);

    return useQuery({
        queryKey: contentInsightsKeys.punchcard(workspace.id, days),
        queryFn: () => httpContentInsightsGateway.punchcard(days),
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
