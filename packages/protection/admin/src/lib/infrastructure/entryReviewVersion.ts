import type { EntryReview } from '../domain/types';

/**
 * One answer already cached under an entry's review prefix: the key it is held
 * under, and the answer itself (`undefined` while a query has never resolved).
 *
 * Shaped to be exactly what `QueryClient.getQueriesData` hands back, so the
 * decision below can be a pure function of the cache rather than a method on it.
 */
export type CachedEntryReview = readonly [
    queryKey: readonly unknown[],
    review: EntryReview | undefined
];

/**
 * The version component of one entry's review key — `updatedAt`, **unless** an
 * answer already cached for this entry says the type is unprotected.
 *
 * A save moves `updatedAt`, which is how the panel learns that the head revision
 * changed and its approvals no longer count. But `reviewScopeOf` cannot know
 * whether a rule exists: it returns a scope for *any* saved publishable entry,
 * and only the first response says `protected: false`. Minting a new key on
 * every save of an unprotected type would spend a request per save to be told
 * again that there is nothing to review — which is the inertness
 * `protection:I-03` / `I-04` promise: with no rule, the editor behaves byte for
 * byte as it does with the plugin uninstalled.
 *
 * Reusing the token is safe precisely *because* the answer is `protected: false`:
 * every reader bails on that flag before it looks at another field (the chip,
 * the rail block and the publish verdict all do), so nothing observable can have
 * moved. A rule written while such an editor is open is the accepted cost — the
 * same one `useSaveProtectionRule` documents for not invalidating open panels —
 * and the next editor opened reads the new rule on its first request.
 *
 * The **newest** unprotected token wins, so the answer does not depend on the
 * order the cache happens to enumerate its entries: the tokens are ISO-8601
 * instants, which sort lexicographically. A cached answer that says `protected`
 * is ignored here, because that is the case where a new version genuinely has a
 * new answer.
 */
export function entryReviewVersion(
    cached: readonly CachedEntryReview[],
    updatedAt: string
): string {
    let unprotected: string | null = null;
    for (const [queryKey, review] of cached) {
        if (!review || review.protected) continue;
        // `entryReviewKey` puts the version last, and this is one of the two
        // places that depends on it.
        const token = queryKey[queryKey.length - 1];
        if (typeof token !== 'string') continue;
        if (unprotected === null || token > unprotected) unprotected = token;
    }
    return unprotected ?? updatedAt;
}
