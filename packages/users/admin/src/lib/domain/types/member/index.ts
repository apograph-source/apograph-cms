import type { AvatarColor } from '@apograph/design-system';

/** The three assignable system roles, by stable key. */
export type MemberRole = 'admin' | 'contributor' | 'viewer';

/**
 * Account lifecycle state, mirroring the server's `user_status` enum.
 * `pending` renders as the "Invited" pill — an invite that has been sent but
 * not yet accepted.
 */
export type MemberStatus = 'pending' | 'active' | 'disabled';

/** A workspace a member belongs to, as shown in the Workspaces column. */
export type MemberWorkspace = {
    /** Stable workspace id. */
    id: string;
    /** Display name. */
    name: string;
    /** Short description, or `null` when none is set. */
    description: string | null;
    /** Two-letter initials shown in the avatar. */
    initials: string;
    /** Accent color tinting the workspace's avatar. */
    color: AvatarColor;
};

/** A member of the system — one row of the Members table. */
export type Member = {
    /** Stable user id. */
    id: string;
    /** Display name; falls back to the email until the invite is accepted. */
    name: string;
    /** Contact email. */
    email: string;
    /** Two-letter initials shown in the avatar. */
    initials: string;
    /** Accent color tinting the member's avatar (derived, not persisted). */
    color: AvatarColor;
    /**
     * The member's single global role, by key — or `null` when they hold a
     * custom role outside the three assignable system roles. Never guess a key
     * for `null`: render {@link Member.roleName} instead and lock any control
     * that would reassign it.
     */
    role: MemberRole | null;
    /** Human-readable role label (e.g. `Administrator`). */
    roleName: string;
    /** Account lifecycle state. */
    status: MemberStatus;
    /** When the membership was created; the invite date while `pending`. */
    joinedAt: Date;
    /**
     * Whether this member is the only active administrator, computed
     * server-side. When set, demote/disable controls are disabled with an
     * explanatory tooltip — the server rejects those actions regardless.
     */
    isLastAdmin: boolean;
    /** The workspaces this member belongs to. */
    workspaces: MemberWorkspace[];
};

/**
 * A member the API just issued an invite token for — the response of inviting
 * and of resending, and nothing else.
 *
 * The token comes back **once** and is never readable again (the server stores
 * only its hash), so the admin is the delivery channel — unless the deployment
 * configured a mail provider, in which case the message carries the link and
 * this is `null`. Both are ordinary outcomes, and the UI says which happened
 * rather than showing a link that goes nowhere.
 */
export type InvitedMember = Member & {
    /**
     * The raw invite token, shown to the inviting admin exactly once, or `null`
     * when the invitation was emailed instead.
     */
    inviteToken: string | null;
};

/**
 * A member the API just issued a password-reset token for — the response of
 * `POST /users/:id/password-reset`, and nothing else. On the same terms as
 * {@link InvitedMember.inviteToken}: the raw token once, or `null` when a mail
 * provider delivered the link instead.
 */
export type MemberWithResetToken = Member & {
    /**
     * The raw password-reset token, shown to the issuing admin exactly once, or
     * `null` when the link was emailed instead.
     */
    resetToken: string | null;
};

/** One page of members plus the pagination envelope. */
export type MemberList = {
    /** The members on this page. */
    items: Member[];
    /** Total members matching the search, across all pages. */
    total: number;
    /** 1-based page number. */
    page: number;
    /** Rows per page. */
    pageSize: number;
};
