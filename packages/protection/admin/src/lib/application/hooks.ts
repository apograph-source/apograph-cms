import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient
} from '@tanstack/react-query';
import { type ApiError } from '@ortha/utils-admin';
import type {
    EntryReview,
    EntryReviewStatus,
    NewEntryProtection,
    ProtectionInsights,
    ProtectionRule,
    ProtectionRuleRecord,
    ReviewerCandidate,
    ReviewQueue
} from '../domain/types';
import {
    entryReviewKey,
    entryReviewPrefix,
    insightsKey,
    newEntryProtectionKey,
    newEntryProtectionPrefix,
    queueKey,
    reviewerCandidatesKey,
    reviewStatusKey,
    rulesKey
} from '../infrastructure/protectionKeys';
import {
    entryReviewProtected,
    entryReviewVersion
} from '../infrastructure/entryReviewVersion';
import {
    httpProtectionGateway,
    type EntryRef,
    type RequestReviewInput,
    type ReviewQueueParams,
    type RuleAddress
} from '../infrastructure/protectionGateway';

/** What the entry surfaces need to address and cache one entry's review. */
export type EntryReviewScope = EntryRef & {
    /** The open workspace — part of every key; see `protectionKeys`. */
    workspaceId: string;
    /**
     * The entry's `updatedAt` — the **version** component of the review key.
     *
     * It is in the key, not a dependency of an invalidation, and that is what
     * keeps this plugin out of content's save path. A save moves the head
     * revision, which changes *which approvals count* — so the answer the query
     * holds is about a version that no longer exists. Content stamps a new
     * `updatedAt` on every save and primes the editor's read-one cache with the
     * write's own response, so the save produces a new key and the panel reads
     * afresh, without protection reaching into a mutation it does not own or
     * content learning that protection exists.
     *
     * {@link useEntryReview} puts it in the key through
     * {@link entryReviewVersion}, which holds the previous token when the type
     * turned out to be unprotected — there is no answer for a save to change
     * when there is no rule, and a request per save to learn that again is the
     * inertness `protection:I-03` / `I-04` promise.
     */
    updatedAt: string;
};

/**
 * What the cache already holds about one entry's review — asked in **one**
 * place, because both things derived from it are derived from the same read.
 *
 * `queryKey` is the array every surface has to land on: the chip, the rail block
 * and the publish verdict each call `reviewScopeOf` and then this, so they share
 * one cache entry and cannot disagree about whether publication is held
 * (`protection:I-21` — one publish path holding while another does not is the
 * failure). Deriving it from the cache as well as from the scope is why it is a
 * function of the client rather than of the scope alone; see
 * {@link entryReviewVersion} for what the cache decides.
 *
 * `typeKnownProtected` is the other half, and it is knowledge about the *type*
 * rather than about a version: it is what tells a reader whose key has just
 * moved that it is waiting on a rule's numbers rather than that there is no rule
 * — see {@link entryReviewProtected}.
 */
function cachedEntryReview(
    queryClient: QueryClient,
    { workspaceId, typeName, entryId, updatedAt }: EntryReviewScope
) {
    const cached = queryClient.getQueriesData<EntryReview>({
        queryKey: entryReviewPrefix(workspaceId, typeName, entryId)
    });
    return {
        queryKey: entryReviewKey(
            workspaceId,
            typeName,
            entryId,
            entryReviewVersion(cached, updatedAt)
        ),
        typeKnownProtected: entryReviewProtected(cached)
    };
}

/**
 * The scope for the entry open in the editor, or `null` when there is nothing
 * to review yet.
 *
 * `null` on a create form and on a **non-publishable** type: review guards the
 * `draft → published` transition, so a type that is always live has no
 * transition to hold. Every surface reads this rather than assembling the scope
 * itself, so all three agree on when the feature applies at all.
 */
export function reviewScopeOf(context: {
    schema: { name: string; publishable?: boolean };
    entry?: { id: string; updatedAt: string };
    isCreate: boolean;
    workspaceId: string;
}): EntryReviewScope | null {
    if (context.isCreate || !context.entry || !context.schema.publishable) {
        return null;
    }
    return {
        workspaceId: context.workspaceId,
        typeName: context.schema.name,
        entryId: context.entry.id,
        updatedAt: context.entry.updatedAt
    };
}

/**
 * One entry's review state.
 *
 * Enabled only for a saved entry on a caller who may read content — the create
 * form has no entry to review, and the read is `content:read`-gated server-side
 * anyway. Deliberately **not** gated on `protection:manage`: an ordinary
 * contributor has to see "0 of 2" on their own draft, which is the whole
 * purpose of the panel.
 *
 * Alongside the query it reports **`typeKnownProtected`** — whether an answer
 * already cached for this entry said a rule is in force. It is the query result's
 * only companion because it is the only fact that outlives a version: a save
 * mints a new key and `data` is `undefined` until the read lands, and the publish
 * verdict has to tell "no rule" from "a rule whose numbers we are re-reading"
 * across exactly that gap. It carries no numbers, on purpose — those are what the
 * save invalidated. There is no `placeholderData` here for the same reason: the
 * previous answer would re-show `Reviewed · N of N` about a version that no
 * longer exists.
 */
export function useEntryReview(scope: EntryReviewScope | null, enabled = true) {
    const queryClient = useQueryClient();
    // `enabled` already guarantees the query never runs without a scope, but the
    // compiler cannot see through it — the same narrowing gap content's own
    // `useEntryRelations` closes the same way.
    const target = scope as EntryReviewScope;
    const active = enabled && !!scope;
    const cached = scope ? cachedEntryReview(queryClient, scope) : null;
    const query = useQuery<EntryReview, ApiError>({
        queryKey: cached?.queryKey ?? ['protection', 'entry-review', 'idle'],
        queryFn: () =>
            httpProtectionGateway.getEntryReview({
                typeName: target.typeName,
                entryId: target.entryId
            }),
        enabled: active
    });
    return {
        ...query,
        /**
         * Whether a rule is in force for this entry's type, as far as anything
         * cached says — `false` while nothing at all is known about it, which is
         * every first render.
         */
        typeKnownProtected: active && !!cached?.typeKnownProtected
    };
}

/**
 * Refreshes only what a vote changed.
 *
 * A vote or a request moves the review state and nothing else: the entry's own values, its
 * relations, its media and its version timeline are all exactly as they were.
 * Refetching the editor through `refreshEntryCaches` would re-read a record and
 * a whole revision list to learn a number this one query already carries — the
 * over-invalidation the admin-plugin skill warns about, and it is visible as a
 * flicker on a rail the person is looking at.
 *
 * It names the **prefix**, not the full key: a vote moves no `updatedAt` —
 * protection owns no content table — so the version the panel is holding is
 * whichever one it read, including the one {@link entryReviewVersion} held on to
 * for an unprotected type. `entryReviewKey` keeps `version` last so this stays a
 * prefix of it, and matching by prefix is what makes the invalidation land on
 * the query that is actually mounted instead of on a key re-derived here that
 * could differ by a beat.
 */
function refreshReview(
    queryClient: QueryClient,
    { workspaceId, typeName, entryId }: EntryReviewScope
) {
    return queryClient.invalidateQueries({
        queryKey: entryReviewPrefix(workspaceId, typeName, entryId)
    });
}

/**
 * Who the caller may ask to review this entry.
 *
 * Enabled by the caller — the request dialog asks only while it is open, so an
 * editor that never opens it pays nothing.
 */
export function useReviewerCandidates(
    scope: EntryReviewScope | null,
    enabled: boolean
) {
    const target = scope as EntryReviewScope;
    return useQuery<ReviewerCandidate[], ApiError>({
        queryKey: scope
            ? reviewerCandidatesKey(
                  scope.workspaceId,
                  scope.typeName,
                  scope.entryId
              )
            : ['protection', 'reviewer-candidates', 'idle'],
        queryFn: () =>
            httpProtectionGateway.listReviewerCandidates({
                typeName: target.typeName,
                entryId: target.entryId
            }),
        enabled: enabled && !!scope
    });
}

/** Opens the ask naming its reviewers, or replaces who the open one names. */
export function useRequestReview(scope: EntryReviewScope) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, RequestReviewInput>({
        mutationFn: (input) => httpProtectionGateway.requestReview(input),
        onSuccess: () => refreshReview(queryClient, scope)
    });
}

/** Withdraws the open ask. Only its author or an administrator may. */
export function useWithdrawRequest(scope: EntryReviewScope) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, EntryRef>({
        mutationFn: (ref) => httpProtectionGateway.withdrawRequest(ref),
        onSuccess: () => refreshReview(queryClient, scope)
    });
}

/** Approves the head revision. */
export function useApprove(scope: EntryReviewScope) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, EntryRef>({
        mutationFn: (ref) => httpProtectionGateway.approve(ref),
        onSuccess: () => refreshReview(queryClient, scope)
    });
}

/** Withdraws this person's own approval. */
export function useWithdrawVote(scope: EntryReviewScope) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, EntryRef>({
        mutationFn: (ref) => httpProtectionGateway.withdrawVote(ref),
        onSuccess: () => refreshReview(queryClient, scope)
    });
}

/**
 * What publishing a **new** entry of `typeName` would meet — the create form's
 * answer, where {@link useEntryReview} has no entry to ask about.
 *
 * Enabled only by the caller for a create form on a publishable type: every
 * other editor has an entry and reads its review instead.
 */
export function useNewEntryProtection(
    workspaceId: string,
    typeName: string,
    enabled: boolean
) {
    return useQuery<NewEntryProtection, ApiError>({
        queryKey: newEntryProtectionKey(workspaceId, typeName),
        queryFn: () => httpProtectionGateway.getNewEntryProtection(typeName),
        enabled
    });
}

/**
 * Every rule the open workspace holds.
 *
 * Gated by the caller rather than here: the list route is `protection:manage`,
 * administrator-only, so a member without it would spend a request to be told
 * 403 and the settings section shows them why instead.
 */
export function useProtectionRules(workspaceId: string, enabled = true) {
    return useQuery<ProtectionRuleRecord[], ApiError>({
        queryKey: rulesKey(workspaceId),
        queryFn: () => httpProtectionGateway.listRules(),
        enabled
    });
}

/** What a rule save needs: where it goes, and all six fields. */
export type SaveRuleInput = RuleAddress & { rule: ProtectionRule };

/**
 * Writes one rule.
 *
 * Invalidates the rules key and the create forms' answers, and **not** the entry
 * reviews. A rule changes which entries are held, but every entry panel reads
 * its own `entryReviewKey`, keyed by the entry's `updatedAt` — and a rule write
 * moves no entry's `updatedAt`, so clearing those keys would refetch every open
 * editor to learn a number none of them is showing. An editor opened after the
 * change reads the new rule on its first request, which is the only moment it
 * can matter.
 *
 * The same holds for an editor already open on a type that *was* unprotected:
 * {@link entryReviewVersion} keeps serving it the answer it has until it is
 * reopened, deliberately, because the alternative is a request on every save of
 * every unprotected entry in the installation.
 */
export function useSaveProtectionRule(workspaceId: string) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, SaveRuleInput>({
        mutationFn: ({ kind, slug, rule }) =>
            httpProtectionGateway.saveRule({ kind, slug }, rule),
        onSuccess: () => invalidateRules(queryClient, workspaceId)
    });
}

/** Removes one rule, leaving no row. */
export function useDeleteProtectionRule(workspaceId: string) {
    const queryClient = useQueryClient();
    return useMutation<void, ApiError, RuleAddress>({
        mutationFn: (address) => httpProtectionGateway.deleteRule(address),
        onSuccess: () => invalidateRules(queryClient, workspaceId)
    });
}

/**
 * Refreshes the workspace's rule list after a write — and the create forms'
 * answers, which are a rule read in all but name. Those are keyed by nothing a
 * rule write moves, so without this an open create form would keep offering an
 * ordinary publish of a type that has just been protected.
 */
function invalidateRules(queryClient: QueryClient, workspaceId: string) {
    return Promise.all([
        queryClient.invalidateQueries({ queryKey: rulesKey(workspaceId) }),
        queryClient.invalidateQueries({
            queryKey: newEntryProtectionPrefix(workspaceId)
        })
    ]);
}

/**
 * One page of the workspace's open review requests.
 *
 * `keepPreviousData` because the page splits one window into two tabs: without
 * it, switching tabs during a refetch would empty the table under the person's
 * cursor even though the rows it needs are already cached.
 *
 * Gated by the caller rather than here — the route is `content:read`, which
 * anybody who can open the Content Library already holds.
 */
export function useReviewQueue(
    workspaceId: string,
    params: ReviewQueueParams = {},
    enabled = true
) {
    return useQuery<ReviewQueue, ApiError>({
        queryKey: queueKey(workspaceId, params),
        queryFn: () => httpProtectionGateway.listQueue(params),
        placeholderData: keepPreviousData,
        enabled
    });
}

/**
 * Review status for a whole records page, keyed by entry id.
 *
 * `enabled` matters more here than anywhere else in this plugin: the records
 * column is **hidden by default** and its `useRowsData` hook runs on every
 * render whether or not the column is shown, so ignoring `isVisible` would fire
 * this on every page of every list for numbers nobody is looking at — the
 * over-fetching alarms' own column documents having had to fix.
 */
export function useReviewStatusByEntry(
    workspaceId: string,
    typeName: string,
    entryIds: readonly string[],
    enabled = true
) {
    return useQuery<Record<string, EntryReviewStatus>, ApiError>({
        queryKey: reviewStatusKey(workspaceId, typeName, entryIds),
        queryFn: () =>
            httpProtectionGateway.reviewStatusByEntry(typeName, entryIds),
        enabled: enabled && entryIds.length > 0
    });
}

/**
 * The Insights card's figures.
 *
 * No `staleTime` tuning of its own — the dashboard mounts every card at once and
 * the shared client's defaults are what keep the page from re-reading them on
 * every focus.
 */
export function useProtectionInsights(workspaceId: string) {
    return useQuery<ProtectionInsights, ApiError>({
        queryKey: insightsKey(workspaceId),
        queryFn: () => httpProtectionGateway.insights()
    });
}
