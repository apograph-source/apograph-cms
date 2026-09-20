import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * The Drizzle client type this plugin exposes — the single source of truth
 * for "what the db client is". Consumers (other plugins, services) annotate
 * injected clients with this, never the dialect-specific `NodePgDatabase`,
 * so a dialect change (e.g. to MySQL) is a one-line edit **here** rather
 * than a sweep across every consumer.
 */
export type Database = NodePgDatabase;

/**
 * Configuration for the database plugin.
 *
 * The pool settings are optional and default to the values in
 * `src/lib/utils/db.ts`. They exist because `pg`'s own defaults for two of
 * them are "unbounded": a checkout waits **forever** for a free client, and a
 * statement runs forever. Leaving those implicit turns pool exhaustion into a
 * process that stops answering with no error and no log.
 */
export interface DatabasePluginConfig {
    /** PostgreSQL connection string. */
    connectionString: string;
    /**
     * Maximum clients the pool opens. Defaults to 10 (`pg`'s own default, made
     * explicit). Must leave headroom for the outbox drain, which holds one
     * client for a whole batch while its subscribers acquire their own.
     */
    poolMax?: number;
    /**
     * How long a checkout waits for a free client before failing, in ms.
     * Defaults to 10 000. `pg` defaults this to `0` — wait forever — which is
     * why it is set here: a bounded wait turns exhaustion into a legible error
     * on one request instead of a silent, permanent stall of every request.
     */
    connectionTimeoutMillis?: number;
    /**
     * Postgres `statement_timeout` for every session the pool opens, in ms.
     * Off by default (no cap), because a legitimate bulk write here can be
     * long; set it in a deployment that would rather kill a runaway query than
     * let it hold a client.
     */
    statementTimeoutMillis?: number;
    /**
     * How long a **delivered** outbox row is kept, in days. Defaults to 30;
     * `0` never prunes.
     *
     * The table used to grow for the life of the deployment — delivered rows
     * were stamped and nothing ever removed them — so this is the one knob that
     * decides whether `outbox_events` is a queue or an append-only archive of
     * every fact the system has emitted. Only delivered rows are in scope: a
     * pending row is still owed a delivery and a **parked** one is the evidence
     * of a gap in the audit trail, and neither is ever deleted by age.
     */
    outboxRetentionDays?: number;
}
