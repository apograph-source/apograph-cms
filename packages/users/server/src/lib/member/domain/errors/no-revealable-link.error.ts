import { MEMBER_ERROR_CODES, type MemberErrorCode } from './error-codes';

/**
 * Thrown when there is no outstanding message whose link could be revealed.
 *
 * Two situations produce it, and the operator's next move is the same in both:
 * resend. Either the message was handed to the relay — in which case the row,
 * and the only readable copy of the token with it, was deleted the moment it
 * went out — or there was never a message for this member to begin with.
 *
 * That is the shape of the feature, not a limitation to work around: reveal is
 * the answer to "it never arrived", and a second copy of a secret that *did*
 * arrive is exactly what ADR-0018 §4 refuses to keep lying around.
 */
export class NoRevealableLinkError extends Error {
    /** Stable wire code — see {@link MEMBER_ERROR_CODES}. */
    readonly code: MemberErrorCode;

    constructor(public readonly userId: string) {
        super(
            'There is no undelivered message for this member; its link is not recoverable. ' +
                `Resend the invite or re-issue the reset instead: ${userId}`
        );
        this.name = 'NoRevealableLinkError';
        this.code = MEMBER_ERROR_CODES.NO_REVEALABLE_LINK;
    }
}
