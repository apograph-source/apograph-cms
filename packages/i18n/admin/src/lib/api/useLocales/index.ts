import { useQuery } from '@tanstack/react-query';
import { apiClient, STALE_TIME, toApiError } from '@orthacms/utils-admin';
import { LOCALES_PATH } from '../../constants';
import type { Locale, LocalesResult } from '../../types/locale';

/** Query key of the configured-locales read (global — not workspace data). */
export const localesKey = ['i18n-locales'] as const;

/** Loads the configured locales from `GET /api/i18n/locales`. */
async function fetchLocales(): Promise<LocalesResult> {
    try {
        const { data } = await apiClient.get<LocalesResult>(LOCALES_PATH);
        return data;
    } catch (error) {
        throw toApiError(error);
    }
}

/**
 * The configured content locales, in display order. Server configuration —
 * immutable for the session, so cached forever. Exposes the resolved
 * `locales` array and the `defaultLocale` (exactly one is configured).
 *
 * **`isError` is part of the contract, not a detail.** Every localization
 * affordance in this plugin is gated on `locales.length > 0`, so a failed read
 * used to delete the whole feature silently — including the switcher, the one
 * control that can clear a `?locale=` still scoping the list. Consumers must
 * tell "no locales configured" (render nothing) from "we could not ask"
 * (say so), which is what this flag is for.
 */
export function useLocales(): {
    locales: Locale[];
    defaultLocale: Locale | undefined;
    isPending: boolean;
    /** The read failed — distinct from "there are none". */
    isError: boolean;
    /** Retry the read, for an error affordance. */
    refetch: () => void;
} {
    const query = useQuery({
        queryKey: localesKey,
        staleTime: STALE_TIME.Forever,
        queryFn: fetchLocales
    });
    const locales = query.data?.items ?? [];
    return {
        locales,
        defaultLocale: locales.find((locale) => locale.isDefault),
        isPending: query.isPending,
        isError: query.isError,
        refetch: () => void query.refetch()
    };
}
