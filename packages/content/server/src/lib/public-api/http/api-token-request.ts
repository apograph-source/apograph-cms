import type {
    ApiTokenScope,
    AuthenticatedRequest
} from '@orthacms/identity-server';

/**
 * The token a public-API request authenticated with, as {@link ApiTokenGuard}
 * attaches it. A deliberately narrow projection of the stored record: the
 * hash, the creator, and the timestamps are management concerns and have no
 * business on the request.
 */
export interface PublicApiToken {
    /** Stable token id — what a log line or a rate limiter keys on. */
    id: string;
    /** The token's display name, for diagnostics. */
    name: string;
    /** Access level, which the guard turns into a permission set. */
    scope: ApiTokenScope;
    /** Every workspace this token may act in — always at least one. */
    workspaceIds: readonly string[];
    /**
     * The user who minted the token, when still known.
     *
     * Carried for **attribution on writes**, not for authorization — the token
     * acts as itself, and this user's role grants are never consulted (revoking
     * the token has to be enough). A media upload has a NOT NULL `uploaded_by`,
     * so something must go there; the accountable human is the one who created
     * the credential, and recording them keeps the Media Library's uploader
     * column meaningful instead of blank.
     */
    createdBy: string | null;
}

/**
 * A public-API request after {@link ApiTokenGuard} has run: the verified token
 * is attached as `apiToken`, and {@link ApiTokenWorkspaceGuard} additionally
 * stamps the resolved `workspaceId` (inherited from `AuthenticatedRequest`, so
 * `@CurrentWorkspace()` reads it exactly as it does on the admin routes).
 *
 * `user` is always `undefined` here — these routes are `@Public()`, so the
 * app-wide session `AuthGuard` never runs on them.
 */
export interface ApiTokenRequest extends AuthenticatedRequest {
    apiToken?: PublicApiToken;
}
