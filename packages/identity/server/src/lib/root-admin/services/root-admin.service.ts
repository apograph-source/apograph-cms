import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { HashingService } from '../../auth/services/hashing.service';
import { InjectIdentityConfig } from '../../identity.tokens';
import type { IdentityPluginConfig } from '../../types';
import { roles, users } from '../../schema';
import { MissingRootAdminPasswordError } from '../errors';

/** The `admin` role key, seeded by `SystemRolesSeeder` (matches SYSTEM_ROLES). */
const ADMIN_ROLE_KEY = 'admin';

/** Whether the root admin was newly inserted or already present. */
export type RootAdminOutcome = 'created' | 'exists';

/** Outcome of a config-driven bootstrap, carrying the email for logging. */
export interface RootAdminBootstrapResult {
    /** Whether the account was created or already existed. */
    outcome: RootAdminOutcome;
    /** The provisioned account's email. */
    email: string;
}

/**
 * Provisions the root administrator. The logic lives in a service (injected db,
 * hashing, and config) rather than a free function; `RootAdminSeeder` is the
 * thin lifecycle hook that calls {@link bootstrapFromConfig} on boot.
 */
@Injectable()
export class RootAdminService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly hashing: HashingService,
        @InjectIdentityConfig() private readonly config: IdentityPluginConfig
    ) {}

    /**
     * Reads the host's `rootAdmin` config and provisions accordingly. Returns
     * `null` when unconfigured (no email); throws
     * {@link MissingRootAdminPasswordError} when an email has no password
     * (fail-fast). Otherwise ensures the account and reports the outcome.
     */
    async bootstrapFromConfig(): Promise<RootAdminBootstrapResult | null> {
        const rootAdmin = this.config.rootAdmin;
        if (!rootAdmin?.email) return null;
        if (!rootAdmin.password) {
            throw new MissingRootAdminPasswordError(rootAdmin.email);
        }
        const outcome = await this.ensure(
            rootAdmin.email,
            rootAdmin.password,
            rootAdmin.name
        );
        return { outcome, email: rootAdmin.email };
    }

    /**
     * Idempotently ensures one `active` administrator with the given
     * credentials. Keyed on the case-insensitive email unique index: a second
     * run, or an already-taken email, is a no-op — it never overwrites an
     * existing account's password, role, or status (non-destructive).
     *
     * Requires the `admin` system role to be seeded first; throws clearly if
     * it is absent rather than inserting a dangling FK.
     *
     * `name` is optional; when given it is stored on the new account. Like the
     * rest of `ensure`, it is **non-destructive** — an already-present email is
     * left untouched, so the name is set only when the row is first created.
     */
    async ensure(
        email: string,
        password: string,
        name?: string
    ): Promise<RootAdminOutcome> {
        const normalizedEmail = email.trim().toLowerCase();
        const passwordHash = await this.hashing.hashPassword(password);

        return this.db.transaction(async (tx) => {
            const [adminRole] = await tx
                .select({ id: roles.id })
                .from(roles)
                .where(eq(roles.key, ADMIN_ROLE_KEY))
                .limit(1);

            if (!adminRole) {
                throw new Error(
                    'Cannot ensure root admin: the "admin" system role is ' +
                        'missing. System roles must be seeded first.'
                );
            }

            const inserted = await tx
                .insert(users)
                .values({
                    email: normalizedEmail,
                    name: name?.trim() || null,
                    passwordHash,
                    roleId: adminRole.id,
                    status: 'active'
                })
                .onConflictDoNothing()
                .returning({ id: users.id });

            return inserted.length > 0 ? 'created' : 'exists';
        });
    }
}
