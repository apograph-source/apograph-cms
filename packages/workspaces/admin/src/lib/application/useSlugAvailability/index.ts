import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@orthacms/utils-admin';
import { Slug } from '../../domain/slug';
import { SlugStatus } from '../../domain/types/wizard';
import { httpWorkspaceGateway } from '../../infrastructure/httpWorkspaceGateway';

/**
 * Live slug-availability check. Debounces input (300ms), then resolves to
 * {@link SlugStatus.Available} / {@link SlugStatus.Taken}. Returns
 * {@link SlugStatus.Empty} for blank input, {@link SlugStatus.Invalid} when the
 * value breaks the {@link Slug} value object's format rule, and
 * {@link SlugStatus.Checking} while debouncing or fetching. Format is validated
 * through the shared {@link Slug} VO so this and the basics schema agree on the
 * one rule the server enforces.
 *
 * A **failed** check resolves to {@link SlugStatus.Unknown}, never
 * {@link SlugStatus.Available}: `query.data` is `undefined` on error, so without
 * an explicit branch the last line would report the outage as the positive
 * answer and unblock the wizard's continue gate — the user would then spend
 * three steps on a slug the server rejects with a `409`.
 */
export function useSlugAvailability(slug: string): SlugStatus {
    const debounced = useDebouncedValue(slug, 300);
    const enabled = !!debounced && Slug.isValid(debounced);

    const query = useQuery({
        queryKey: ['workspaces', 'slug-available', debounced],
        queryFn: () => httpWorkspaceGateway.checkSlugAvailable(debounced),
        enabled,
        staleTime: 30_000
    });

    if (!slug) return SlugStatus.Empty;
    if (!Slug.isValid(slug)) return SlugStatus.Invalid;
    if (slug !== debounced || query.isFetching) return SlugStatus.Checking;
    if (query.isError) return SlugStatus.Unknown;
    return query.data === false ? SlugStatus.Taken : SlugStatus.Available;
}
