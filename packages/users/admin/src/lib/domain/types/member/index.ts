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
 * and of resending, and nothing else. No mailer sends the link yet, so the
 * inviting admin is the delivery channel: the token comes back once, is turned
 * into a link for them to copy, and is never readable again (the server stores
 * only its hash).
 */
export type InvitedMember = Member & {
    /** The raw invite token, shown to the inviting admin exactly once. */
    inviteToken: string;
};

/**
 * A member the API just issued a password-reset token for — the response of
 * `POST /users/:id/password-reset`, and nothing else. No mailer sends the link
 * yet, so the issuing admin is the delivery channel: the token comes back once,
 * is turned into a link for them to hand over, and is never readable again (the
 * server stores only its hash).
 */
export type MemberWithResetToken = Member & {
    /** The raw password-reset token, shown to the issuing admin exactly once. */
    resetToken: string;
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
