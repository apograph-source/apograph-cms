/**
 * Port that answers "do these workspaces exist?" — the referential check
 * `api_token_workspaces` cannot make for itself.
 *
 * A token's bucket names workspaces owned by a **different** plugin, so the
 * join table deliberately carries no cross-plugin foreign key (identity must
 * not depend on `@orthacms/workspaces-server`, which depends back on identity).
 * Without a check somewhere, that means minting a token scoped to an id nobody
 * ever created succeeds and leaves a row pointing at nothing
 * (BUG-identity-server-06) — an operator sees a token that appears configured
 * and silently grants access to no content, and the row survives forever
 * because no cascade will ever reach it.
 *
 * Same inversion identity already uses for `ACTIVITY_RECORDER`: identity owns
 * the port, the workspaces plugin binds an adapter to it, so the package graph
 * stays acyclic. Injected with `@Optional()` — with no workspaces plugin present
 * there is no directory to consult and no ids to validate against, so the check
 * is skipped rather than failing every mint.
 */
export interface WorkspaceDirectory {
    /**
     * The subset of `workspaceIds` that exist. Order and duplicates are not
     * significant; the caller diffs the result against what it asked for, so an
     * implementation may return the set in any order.
     */
    existing(workspaceIds: readonly string[]): Promise<string[]>;
}

/** DI token the workspaces plugin binds to a {@link WorkspaceDirectory}. */
export const WORKSPACE_DIRECTORY = Symbol('WORKSPACE_DIRECTORY');
