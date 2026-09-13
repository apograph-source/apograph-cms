import {
    asAvatarColor,
    avatarColorForId,
    initialsOf
} from '@apograph/utils-admin';
import type {
    InvitedMember,
    Member,
    MemberRole,
    MemberStatus,
    MemberWithResetToken,
    MemberWorkspace
} from '../../domain/types/member';

// The shared wire→model contract for a member. The admin can't import the
// server package (separate apps / module boundaries), so these wire types
// mirror `@apograph/users-server`'s `MemberView`. Every request function that
// returns a member maps it through `toMember`, so the shape and the mapper
// live together here and each hook owns only its own endpoint call.

/** A member's role as returned by the API. */
export type MemberRoleResponse = {
    id: string;
    key: string;
    name: string;
};

/** A member's workspace as returned by the API. */
export type MemberWorkspaceResponse = {
    id: string;
    name: string;
    description: string | null;
    color: string;
};

/**
 * A member as returned by the users API. `name` is `null` until the invite is
 * accepted; `createdAt` is an ISO timestamp (the invite date while
 * `pending`); `isLastAdmin` is the server-computed "sole active admin" flag
 * the guardrail UI reads.
 */
export type MemberResponse = {
    id: string;
    email: string;
    name: string | null;
    role: MemberRoleResponse;
    status: MemberStatus;
    createdAt: string;
    isLastAdmin: boolean;
    workspaces: MemberWorkspaceResponse[];
};

/**
 * A member as returned by the two endpoints that mint an invite token
 * (`POST /users/invites` and `POST /users/:id/invites/resend`). Identical to
 * {@link MemberResponse} plus the raw token — the only responses that carry one.
 */
export type InvitedMemberResponse = MemberResponse & {
    inviteToken: string;
};

/** Maps a workspace from the wire to the admin's presentational shape. */
function toMemberWorkspace(dto: MemberWorkspaceResponse): MemberWorkspace {
    return {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        initials: initialsOf(dto.name),
        color: asAvatarColor(dto.color)
    };
}

/** Maps a member from the wire to the admin's `Member` model. */
export function toMember(dto: MemberResponse): Member {
    const name = dto.name ?? dto.email;
    return {
        id: dto.id,
        name,
        email: dto.email,
        initials: initialsOf(name),
        color: avatarColorForId(dto.id),
        // An unknown role key (a custom, non-system role — the server's
        // `Role.create` accepts any non-empty key) maps to `null`, NOT to a
        // guessed `viewer`. Coercing it would make the roster and the Role tab
        // positively assert a privilege level the member does not hold; `null`
        // means "not one of the three assignable roles", and the UI falls back
        // to the server's own `roleName` and refuses to offer a change.
        role: isMemberRole(dto.role.key) ? dto.role.key : null,
        roleName: dto.role.name,
        status: dto.status,
        joinedAt: new Date(dto.createdAt),
        isLastAdmin: dto.isLastAdmin,
        workspaces: dto.workspaces.map(toMemberWorkspace)
    };
}

/**
 * Maps an invite/resend response to the admin's {@link InvitedMember} — the
 * mapped member plus the one-time token, carried through verbatim.
 */
export function toInvitedMember(dto: InvitedMemberResponse): InvitedMember {
    return { ...toMember(dto), inviteToken: dto.inviteToken };
}

/**
 * A member as returned by the one endpoint that mints a password-reset token
 * (`POST /users/:id/password-reset`). Identical to {@link MemberResponse} plus
 * the raw token — the only response that carries one.
 */
export type PasswordResetMemberResponse = MemberResponse & {
    resetToken: string;
};

/**
 * Maps a password-reset response to the admin's {@link MemberWithResetToken} —
 * the mapped member plus the one-time token, carried through verbatim.
 */
export function toMemberWithResetToken(
    dto: PasswordResetMemberResponse
): MemberWithResetToken {
    return { ...toMember(dto), resetToken: dto.resetToken };
}

/** Whether a wire role key is one of the admin's assignable roles. */
function isMemberRole(key: string): key is MemberRole {
    return key === 'admin' || key === 'contributor' || key === 'viewer';
}
