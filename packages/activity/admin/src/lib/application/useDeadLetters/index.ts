import { useQuery } from '@tanstack/react-query';
import { httpActivityGateway } from '../../infrastructure/httpActivityGateway';
import { activityKeys } from '../../infrastructure/activityKeys';

/**
 * Rows the banner asks for — enough to name the distinct kinds it lists, not a
 * page anybody reads.
 */
export const NOTICE_DEAD_LETTER_LIMIT = 5;

/**
 * Rows the dialog asks for. Large enough that an operator dealing with a real
 * incident sees the whole of it in one go, small enough to stay one request;
 * the dialog says "showing N of {total}" so a larger `total` is never silently
 * implied away.
 */
export const DIALOG_DEAD_LETTER_LIMIT = 50;

/**
 * How many events could not be recorded — the completeness of the log the page
 * is showing.
 *
 * Its own query rather than part of `useActivityLog`, for the reason every
 * widget on the Insights page owns its own request: this is a caveat about the
 * list, and a caveat that fails must not take the list down with it. A page
 * that renders no rows because the *warning* about the rows errored is strictly
 * worse than one that renders the rows without the warning.
 *
 * `limit` is part of the query key, so the banner's five rows and the dialog's
 * fifty are two cache entries rather than one that overwrites the other.
 *
 * `enabled` must be the caller's confirmed `activity:read`, the same key the
 * route is gated on: `activity:I-28` says the admin makes **no request at all**
 * without it, and leaning on a page's early return instead is a guarantee that
 * evaporates the moment a second surface mounts this hook.
 */
export function useDeadLetters(limit: number, enabled = true) {
    return useQuery({
        queryKey: activityKeys.deadLetters(limit),
        queryFn: () => httpActivityGateway.deadLetters(limit),
        enabled
    });
}
