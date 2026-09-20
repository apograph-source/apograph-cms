import { Inject } from '@nestjs/common';

/**
 * DI tokens and their inject decorators for the identity plugin. Kept in a
 * dependency-free module (imports only `@nestjs/common`) so providers and
 * services can reference them without forming an import cycle with
 * `identity.module.ts`.
 *
 * The Drizzle client is injected with `@InjectDatabase()` from
 * `@orthacms/database` directly — identity has no token of its own for it.
 */

/**
 * Injection token for the resolved identity configuration. Internal — not
 * part of the public barrel until a consumer outside this package injects it.
 */
export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

/** Parameter decorator that injects the identity configuration. */
export const InjectIdentityConfig = (): ParameterDecorator =>
    Inject(IDENTITY_CONFIG);
