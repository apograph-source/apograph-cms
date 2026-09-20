import { useCallback, useState } from 'react';
import { HTTP_STATUS } from '@orthacms/utils-admin';
import { Email } from '../../domain/value-objects/email';
import type { MemberRole } from '../../domain/types/member';
import { inviteLinkFor } from '../../infrastructure/inviteLink';
import { useInviteMember } from '../useInviteMember';

/** The fields the invite wizard collects, before the final guard + submit. */
export type InviteMemberDraft = {
    /** The invitee's email (trimmed by the flow). */
    email: string;
    /** The global role granted on acceptance. */
    role: MemberRole;
    /** Optional display name (blank becomes omitted). */
    name?: string;
    /** Workspaces to grant access to; `all` is expanded to ids by the caller. */
    workspaceIds: string[];
};

/**
 * Why the last submission failed, as a machine key the page maps to its inline
 * alert copy: `taken` (email already exists — `409`) or `failed` (anything
 * else).
 */
export type InviteErrorReason = 'taken' | 'failed';

/** A completed invite, and the link the admin now has to deliver. */
export type SentInvite = {
    /** The invitee's email, as accepted by the server. */
    email: string;
    /**
     * The full invite link, built from the one-time token — or `null` when the
     * server emailed it and returned no token, which is what a deployment with
     * a mail provider does.
     */
    link: string | null;
};

/** What {@link useInviteMemberFlow} returns. */
export type InviteMemberFlow = {
    /**
     * Runs the invite use case: guards the email through the {@link Email} value
     * object, POSTs via the invite mutation (cache invalidation), then records
     * the resulting link in {@link sent}. Rejections are swallowed — the caller
     * reads {@link errorReason} to render the inline alert and let the user
     * retry.
     */
    submit: (draft: InviteMemberDraft) => Promise<void>;
    /** Whether an invite is currently in flight. */
    submitting: boolean;
    /** Why the last submission failed, or `null` when it hasn't. */
    errorReason: InviteErrorReason | null;
    /**
     * The invite that was just sent, or `null` while the wizard is still
     * collecting. Set once, and never re-fetchable — the server returns the raw
     * token exactly once, so this state is the only copy.
     */
    sent: SentInvite | null;
};

/**
 * The invite-member use-case hook. Orchestrates the wizard's submission — Email
 * VO validation → invite → the shareable link — so the invite page stays layout
 * + fields and owns none of the flow. The step's continue gate already blocks a
 * malformed email; the {@link Email} guard here is the last check before the
 * request.
 *
 * It deliberately does **not** navigate away on success: with no mail provider
 * configured the response carries the only copy of the link, so leaving the
 * page would throw it away. The page shows it instead, and the admin leaves
 * when they are done with it. With a provider the same page confirms that the
 * invitation was sent, and there is nothing to copy.
 */
export function useInviteMemberFlow(): InviteMemberFlow {
    const invite = useInviteMember();
    const [sent, setSent] = useState<SentInvite | null>(null);

    const submit = useCallback(
        async (draft: InviteMemberDraft): Promise<void> => {
            const email = draft.email.trim();
            try {
                // Guard the shape through the domain VO before hitting the API.
                Email.create(email);

                const created = await invite.mutateAsync({
                    email,
                    role: draft.role,
                    name: draft.name?.trim() || undefined,
                    workspaceIds: draft.workspaceIds
                });
                setSent({
                    email: created.email,
                    link: created.inviteToken
                        ? inviteLinkFor(created.inviteToken)
                        : null
                });
            } catch {
                // The page's inline alert (via `errorReason`) explains; the user
                // can go back, fix the email, and retry.
            }
        },
        [invite]
    );

    const errorReason: InviteErrorReason | null = invite.isError
        ? invite.error.status === HTTP_STATUS.CONFLICT
            ? 'taken'
            : 'failed'
        : null;

    return { submit, submitting: invite.isPending, errorReason, sent };
}
