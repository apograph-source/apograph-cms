/**
 * Query keys for the protection cache.
 *
 * Every key carries the **workspace id**, because the review read is scoped by
 * `apiClient`'s ambient `X-Workspace-Id` header and that header is not sent on
 * a cache hit — without the id in the key, switching workspaces would serve one
 * workspace's answer for another's entry.
 */

/**
 * Everything cached about **one** entry's review, across versions.
 *
 * What a vote invalidates, and what {@link entryReviewKey} extends by one
 * version component. An approval moves the review state without moving the
 * entry — protection owns no content table — so the version a vote has to
 * refresh is whichever one the panel is holding, and only a prefix can say
 * "that one, whatever it is".
 */
export const entryReviewPrefix = (
    workspaceId: string,
    typeName: string,
    entryId: string
) => ['protection', 'entry-review', workspaceId, typeName, entryId] as const;

/**
 * One entry's review state, **as of one version of the entry**.
 *
 * `version` is the entry's `updatedAt` (see `EntryReviewScope`): a save moves
 * the head revision, which changes which approvals count, so the answer held
 * against the previous version is about a version that no longer exists. A new
 * version mints a new key and the panel reads afresh — which is how this plugin
 * stays out of content's save path entirely.
 *
 * It is **last** in the array, and that is load-bearing rather than cosmetic:
 * {@link entryReviewPrefix} has to stay a prefix of it, so a vote — which moves
 * no `updatedAt` at all — can invalidate the panel without knowing which
 * version it is showing. Moving `version` any earlier would leave every
 * approve / withdraw / request silently refreshing nothing.
 */
export const entryReviewKey = (
    workspaceId: string,
    typeName: string,
    entryId: string,
    version: string
) => [...entryReviewPrefix(workspaceId, typeName, entryId), version] as const;

/**
 * Who may be asked to review one entry.
 *
 * Deliberately **without** the version the scope now carries: the answer is
 * every member holding `content:approve` minus the person asking, and the head
 * revision's author is not excluded from it on purpose — who wrote the current
 * version moves with every save while a request outlives saves
 * (`reviewer-candidates.query.ts`, `protection:I-22`). A save therefore cannot
 * change this list, and putting `updatedAt` in the key would re-ask for it on
 * every save to be handed back the same people.
 */
export const reviewerCandidatesKey = (
    workspaceId: string,
    typeName: string,
    entryId: string
) =>
    [
        'protection',
        'reviewer-candidates',
        workspaceId,
        typeName,
        entryId
    ] as const;

/** Every create form's answer in one workspace — what a rule write refreshes. */
export const newEntryProtectionPrefix = (workspaceId: string) =>
    ['protection', 'new-entry', workspaceId] as const;

/** What a new entry of one type would meet — the create form's read. */
export const newEntryProtectionKey = (workspaceId: string, typeName: string) =>
    [...newEntryProtectionPrefix(workspaceId), typeName] as const;

/**
 * Every rule the workspace holds.
 *
 * Carries the workspace id for the reason above: the list is scoped by the
 * ambient `X-Workspace-Id` header, which is not sent on a cache hit.
 */
export const rulesKey = (workspaceId: string) =>
    ['protection', 'rules', workspaceId] as const;

/**
 * One page of the reviewer queue.
 *
 * The window is part of the key so paging does not serve the previous page's
 * rows; the workspace id is there for the reason every key here carries it.
 */
export const queueKey = (
    workspaceId: string,
    window: { limit?: number; offset?: number } = {}
) =>
    [
        'protection',
        'queue',
        workspaceId,
        window.limit ?? null,
        window.offset ?? null
    ] as const;

/**
 * One records page's review statuses.
 *
 * The **entry ids** are part of the key, not just the type: paging or filtering
 * the list changes which rows are on screen, and a key that ignored them would
 * serve the previous page's numbers against the new page's rows — wrong in a way
 * that looks plausible. Sorted so two renders of the same page share one entry.
 */
export const reviewStatusKey = (
    workspaceId: string,
    typeName: string,
    entryIds: readonly string[]
) =>
    [
        'protection',
        'review-status',
        workspaceId,
        typeName,
        [...entryIds].sort().join(',')
    ] as const;

/** The Insights card's figures. */
export const insightsKey = (workspaceId: string) =>
    ['protection', 'insights', workspaceId] as const;
