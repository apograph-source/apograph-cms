import { MEMBER_ERROR_CODES, type MemberErrorCode } from './error-codes';

/**
 * Thrown when a link is asked for on a deployment that sends no mail.
 *
 * There is nothing to reveal because nothing was hidden: with no provider
 * configured the invite and reset routes still return the raw token, so the
 * link the caller is asking for was already in the response that created it.
 * Answering with this rather than a `404` says which of the two it is.
 */
export class MailNotConfiguredError extends Error {
    /** Stable wire code — see {@link MEMBER_ERROR_CODES}. */
    readonly code: MemberErrorCode;

    constructor() {
        super(
            'This deployment sends no mail, so no link is being withheld — the invite and reset ' +
                'routes return it directly.'
        );
        this.name = 'MailNotConfiguredError';
        this.code = MEMBER_ERROR_CODES.MAIL_NOT_CONFIGURED;
    }
}
