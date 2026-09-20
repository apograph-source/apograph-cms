import type { Database } from '@orthacms/database';
import { RootAdminService } from './root-admin.service';
import { MissingRootAdminPasswordError } from '../errors';
import type { HashingService } from '../../auth/services/hashing.service';
import type { IdentityPluginConfig } from '../../types';

/**
 * A database that fails loudly if it is touched. Both paths under test decide
 * before any query, and the point is that they decide *before* — a bootstrap
 * that opened a transaction to discover it had nothing to do would be a
 * different, slower bug.
 */
function unusedDatabase(): Database {
    return new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(
                    `RootAdminService touched the database (${String(property)}) on a path that should not.`
                );
            }
        }
    ) as Database;
}

function service(rootAdmin?: IdentityPluginConfig['rootAdmin']) {
    const hashing = {
        hashPassword: async () => {
            throw new Error('hashPassword should not be reached');
        }
    } as unknown as HashingService;

    return new RootAdminService(unusedDatabase(), hashing, {
        rootAdmin
    } as IdentityPluginConfig);
}

/**
 * `RootAdminService.bootstrapFromConfig` — the two config-reading branches that
 * run on every boot, before any database work.
 *
 * The interesting one is the second. A configured email with no password is the
 * shape a half-filled `.env` produces, and the tempting behaviours — skip it,
 * or create the account anyway — are both worse than failing: skipping leaves
 * the operator convinced they provisioned an administrator, and creating one
 * without a credential leaves a privileged account whose only remaining
 * protection is that nobody has run a password reset against it yet. Failing
 * the boot is the honest answer, and it has to happen *before* the account is
 * touched.
 */
describe('RootAdminService.bootstrapFromConfig', () => {
    it('does nothing when no root admin is configured', async () => {
        expect(await service().bootstrapFromConfig()).toBeNull();
    });

    it('does nothing when the configured email is blank', async () => {
        const result = await service({
            email: '',
            password: 'a long enough passphrase'
        }).bootstrapFromConfig();

        expect(result).toBeNull();
    });

    it('fails fast when an email is configured with no password', async () => {
        await expect(
            service({
                email: 'root@example.com',
                password: ''
            }).bootstrapFromConfig()
        ).rejects.toBeInstanceOf(MissingRootAdminPasswordError);
    });

    it('names the account and the setting to fix in the failure', async () => {
        // This message is read out of a crashed boot log, so it carries both.
        const error = await service({
            email: 'root@example.com',
            password: ''
        })
            .bootstrapFromConfig()
            .catch((e) => e);

        expect(error.message).toContain('root@example.com');
        expect(error.message).toContain('ORTHA_ROOT_ADMIN_PASSWORD');
    });
});
