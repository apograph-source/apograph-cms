/**
 * Thrown at boot when a root admin email is configured but neither a password
 * nor a password hash is supplied — a misconfiguration that should fail fast
 * rather than create an unusable, password-less administrator.
 */
export class MissingRootAdminPasswordError extends Error {
    constructor(email: string) {
        super(
            `Root admin "${email}" is configured without a password. ` +
                'Set ORTHA_ROOT_ADMIN_PASSWORD.'
        );
        this.name = 'MissingRootAdminPasswordError';
    }
}
