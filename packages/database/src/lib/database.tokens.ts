import { Inject } from '@nestjs/common';

/**
 * Dependency-free DI tokens for the database plugin. Kept in their own module
 * (importing only `@nestjs/common`) so the shared primitives —
 * {@link UnitOfWork}, {@link OutboxWriter}, {@link OutboxDispatcher} — can
 * reference the injection token without importing `database.module`, which in
 * turn imports *them* as providers. Routing the token through the module would
 * form an import cycle whose top-level `@InjectDatabase()` decorators run while
 * the module is still initializing (a TDZ `Cannot access 'InjectDatabase'
 * before initialization`). This is the same token-module pattern plugins use.
 */

/** Injection token for the Drizzle database instance. */
export const DATABASE_TOKEN = Symbol('DATABASE_TOKEN');

/**
 * Parameter decorator that injects the Drizzle database instance.
 */
export const InjectDatabase = (): ParameterDecorator => Inject(DATABASE_TOKEN);

/**
 * Injection token for the outbox retention window, in days.
 *
 * A bare number rather than the whole {@link DatabasePluginConfig}: the
 * connection settings are consumed by `initDatabase` before Nest exists, so
 * nothing in the container has a use for them, and a provider that injects "the
 * config" in order to read one field is a provider that can be handed a
 * connection string it has no business seeing.
 */
export const OUTBOX_RETENTION_DAYS = Symbol('OUTBOX_RETENTION_DAYS');

/**
 * Parameter decorator that injects the outbox retention window, in days.
 * `0` means "never prune".
 */
export const InjectOutboxRetentionDays = (): ParameterDecorator =>
    Inject(OUTBOX_RETENTION_DAYS);
