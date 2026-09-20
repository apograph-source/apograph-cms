import type { Database } from '@orthacms/database';

/**
 * One recordable audit event. A generic shape (`kind` is a plain string,
 * `meta` an open record): each emitting plugin owns its own kind catalogue and
 * meta shape, so the recorder stays decoupled from any one domain's events.
 * `actorId`/`actorEmail` are nullable (system-initiated actions have no actor);
 * `at` defaults to now when omitted.
 */
export interface ActivityRecordInput {
    /** A `domain.action` kind, owned by the emitting plugin. */
    kind: string;
    /** The kind of entity acted upon (e.g. `'user'`, `'workspace'`). */
    subjectType: string;
    /** The acted-upon entity's id (text — not always a uuid). */
    subjectId: string;
    /** Who performed it; `null`/omitted for system-initiated events. */
    actorId?: string | null;
    /** Frozen email snapshot of the actor at record time. */
    actorEmail?: string | null;
    /** Open per-kind payload, owned by the emitter. */
    meta?: Record<string, unknown> | null;
    /** When it happened; defaults to now if omitted. */
    at?: Date;
}

/**
 * The minimal Drizzle executor `record` accepts: the root client or an open
 * transaction. Typed as `Pick<Database, 'insert'>` so a caller can pass its
 * `tx`, committing the audit row in the **same** transaction as the mutation.
 */
export type ActivityExecutor = Pick<Database, 'insert'>;

/**
 * The emit-side port. `@orthacms/activity-server`'s `ActivityService`
 * implements it and binds it to {@link ACTIVITY_RECORDER}; foundational plugins
 * (identity) inject the **token**, never the concrete service — so identity
 * stays free of a dependency on `activity-server` (which depends back on
 * identity for the read API's guard), keeping the package graph acyclic.
 */
export interface ActivityRecorder {
    /**
     * Appends one audit row. Pass `executor = tx` to record in-band with a
     * mutation; defaults to the root client and `at = now`.
     */
    record(
        input: ActivityRecordInput,
        executor?: ActivityExecutor
    ): Promise<void>;
}

/**
 * DI token the host binds to the concrete {@link ActivityRecorder}. Inject it
 * with `@Optional()` so a plugin still boots if no activity plugin is present.
 *
 * @deprecated Wave 3 moved auditing onto the activity plugin's outbox
 * `AuditEventSubscriber` (the single live writer). This token is retained only
 * for a stable public surface — nothing records through it anymore. Emit a
 * domain event (`attachActor` on its payload) and let the subscriber audit it.
 */
export const ACTIVITY_RECORDER = Symbol('ACTIVITY_RECORDER');
