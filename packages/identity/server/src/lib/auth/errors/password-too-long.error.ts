import { MAX_PASSWORD_LENGTH } from '../auth.constants';

/**
 * Thrown by `HashingService.hashPassword` when the plaintext exceeds
 * {@link MAX_PASSWORD_LENGTH} **bytes** — the point bcrypt starts discarding
 * input.
 *
 * The DTOs reject an over-long password long before this, so reaching it means
 * a path that skipped validation entirely: the routeless
 * `ChangePasswordUseCase`, or the root-admin bootstrap reading
 * `ORTHA_ROOT_ADMIN_PASSWORD` straight from the environment. Failing loudly is
 * the point — the alternative is hashing the first 72 bytes and leaving the
 * account protected by a passphrase its owner never chose.
 *
 * Carries no plaintext and no length, so it stays safe to log.
 */
export class PasswordTooLongError extends Error {
    constructor() {
        super(
            `Password exceeds ${MAX_PASSWORD_LENGTH} bytes, which bcrypt would silently truncate.`
        );
        this.name = 'PasswordTooLongError';
    }
}
