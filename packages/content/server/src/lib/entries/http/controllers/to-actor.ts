import type { EventActor } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';

/**
 * The signed-in user as the {@link EventActor} an entry write stamps onto its
 * domain events, or `undefined` when there is nobody to name.
 *
 * Shared by every entry write controller rather than restated per file: the
 * audit log's whole claim is "who did what, when", and a route that quietly
 * dropped the actor would answer the first third of that with "System" while
 * looking identical to one that did not.
 */
export function toActor(user?: PublicUser): EventActor | undefined {
    return user ? { id: user.id, email: user.email ?? null } : undefined;
}
