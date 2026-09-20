# @ortha/database

The database **plugin** for the Ortha CMS server. Owns a single Drizzle ORM
connection (over the `pg` driver) and makes it available to every other plugin.
It also ships the shared **tactical-DDD primitives** every bounded context
builds on: the `DomainEvent` envelope, the `UnitOfWork` transaction boundary,
and the transactional **outbox** (`OutboxWriter` + `OutboxDispatcher`).

This is **infrastructure only** — there is no domain layer here. Feature
plugins own their own tables; this package owns **exactly one** table, the
`outbox_events` outbox (the sanctioned exception to "database owns no schema",
because the outbox is cross-cutting infrastructure, not any one domain's data).

## Package

- Name: `@ortha/database`
- Import: `import { DatabasePlugin, InjectDatabase } from '@ortha/database'`
- Server-only (no admin counterpart). Consumed from source like the other
  workspace packages.

## Conventions

- Uses `interface` for type contracts (not `type`)
- All exported symbols have JSDoc comments
- No `.js` extensions in TypeScript imports
- Plain functions go in `src/lib/utils/`; the NestJS module in `src/lib/`;
  types in `src/lib/types/`
- Always import types with the `type` keyword
- `experimentalDecorators` and `emitDecoratorMetadata` are enabled

## Key exports

- `DatabasePlugin(config)` — factory returning a `ServerPlugin`; opens the
  connection in `onPluginInit`
- `DatabasePluginConfig` — `{ connectionString }`
- `Database` — the Drizzle client type the plugin exposes. **Annotate injected
  clients with this**, not the dialect-specific `NodePgDatabase`, so a dialect
  change is a one-line edit in this package.
- `DatabaseServerPlugin` — the plugin shape, with `databaseConfig` attached
- `initDatabase` / `getDatabase` / `getPool` — the connection singleton
- `DatabaseModule` — global NestJS module providing the Drizzle instance
- `DATABASE_TOKEN` — DI token for the Drizzle instance
- `InjectDatabase` — parameter decorator (`@InjectDatabase()`)
- `DomainEvent` / `createDomainEvent` / `CreateDomainEventParams` — the
  framework-free event envelope and its builder (fills `eventId` + `occurredAt`)
- `DomainEventSubscriber` / `DOMAIN_EVENT_SUBSCRIBERS` — the reactor contract
  and its (default-empty) DI token
- `UnitOfWork` — the transaction-boundary primitive (`run` / `current`)
- `OutboxWriter` — appends events to the outbox in the ambient transaction
- `OutboxDispatcher` — drains the outbox and delivers to subscribers
- `outboxEvents` — the outbox Drizzle table

## Tactical-DDD primitives

These are provided by `DatabaseModule.forRoot()` (global), so any plugin
injects them without importing the module.

- **`DomainEvent`** — a pure-TS envelope: `eventId`, `kind`, `aggregateType`,
  `aggregateId`, `occurredAt`, `payload`. Mint with `createDomainEvent(...)`.
- **`UnitOfWork`** — `run(fn)` executes `fn` inside one transaction; a nested
  `run` **joins** the outer transaction (no new one). Repositories call
  `current()` to get the executor, so every query in the tree joins the active
  transaction implicitly (via `AsyncLocalStorage`) — no `tx` threading. After
  the outermost transaction commits, the outbox is drained best-effort.
  `isActive()` answers "is there an ambient transaction"; `current()` still
  falls back to the pool outside a `run`, because a read outside a unit of work
  is ordinary.
- **Outbox** — `OutboxWriter.append(events)` inserts rows using `uow.current()`,
  so the events commit **atomically** with the state change. Calling it
  **outside** a `run` throws: on the base pool the insert would auto-commit on
  its own connection, and an event that outlives a rolled-back state change is
  the one thing the pattern exists to prevent. `OutboxDispatcher` drains
  undispatched rows (`FOR UPDATE SKIP LOCKED`, oldest first), delivers to
  matching subscribers, and stamps `dispatchedAt`; a failing subscriber bumps
  `attempts` and schedules `nextAttemptAt`, and the row is retried until
  `MAX_DELIVERY_ATTEMPTS`. A 5s poll backstop covers a lost post-commit drain.
  **Delivery is at-least-once → subscribers must be idempotent.**

### Two things the outbox deliberately bounds

- **Retries back off, then stop.** Each failure schedules the row's
  `next_attempt_at` — one second, doubling, plateauing at five minutes — and a
  row that has failed `MAX_DELIVERY_ATTEMPTS` (15, so roughly half an hour) is
  no longer claimed at all. Without the ceiling, `attempts` was written and
  never read: the claim is `ORDER BY occurred_at LIMIT 100`, so a batch's worth
  of permanently-failing rows sat at the head of the queue forever and nothing
  newer was ever delivered again. Without the backoff the ceiling would mean
  nothing either — drains are triggered by commits, so on a busy server fifteen
  attempts is milliseconds. Parked rows stay in the table:
  `dispatched_at IS NULL AND attempts >= 15` is the dead-letter query, and
  clearing `attempts` replays one.
- **A drain in flight survives shutdown.** `onModuleDestroy` clears the poll
  backstop and then **waits** for the drain running at that moment. It used to
  just return, so a drain interrupted by `SIGTERM` died mid-batch with its
  connection: subscribers that had already run were never marked delivered and
  their events were re-delivered on the next boot. At-least-once makes that
  legal and the one shipped subscriber is idempotent, but there is no reason to
  spend the guarantee on an orderly shutdown. Bounded — one batch at most.
- **One drain at a time per process.** `drain()` collapses concurrent callers
  onto the drain in flight plus a single queued one. A drain holds a pool client
  for its whole batch while every subscriber it calls acquires a client of its
  own, so a drain per committing request is a pool deadlock — reproducibly, from
  a dozen concurrent requests over a backlog, with no timeout and no recovery.
  Cross-process concurrency is unaffected: `SKIP LOCKED` is what makes that
  safe.

### Registering a subscriber

A downstream plugin registers at **runtime** from its own
`OnApplicationBootstrap`: inject `OutboxDispatcher` and call `register(...)`.

```typescript
@Injectable()
export class MyReactor implements OnApplicationBootstrap, DomainEventSubscriber {
    readonly kinds = ['workspace.created'] as const; // or '*' for all kinds
    constructor(private readonly dispatcher: OutboxDispatcher) {}
    onApplicationBootstrap() {
        this.dispatcher.register(this);
    }
    async handle(event: DomainEvent): Promise<void> {
        /* idempotent side effect */
    }
}
```

`register(...)` is the chosen mechanism because Nest cannot merge a
multi-provider token across independent dynamic modules. The
`DOMAIN_EVENT_SUBSCRIBERS` token still exists (default `[]`) for statically
co-located subscribers, and is merged with the runtime-registered ones.

## Architecture

- **Singleton connection.** `db.ts` holds module-level `pool` + `database`.
  `initDatabase` is idempotent; `getDatabase`/`getPool` throw if called first.
  The pool connects lazily (on first query), so booting needs no live DB.
- **Bounded pool.** `initDatabase` sets `max` (10) and, crucially,
  `connectionTimeoutMillis` (10 s) explicitly. `pg` defaults the latter to `0` —
  *wait forever* — which turns exhaustion into a process that has silently
  stopped answering rather than one failing request anyone can see. Both, plus
  an optional `statement_timeout`, are overridable through
  `DatabasePluginConfig`.
- **Lifecycle.** The connection is opened in the plugin's `onPluginInit`, which
  [`createServer`](../bootstrap/server/src/lib/create-server.ts) runs **in array
  order before** the Nest app is created. List `DatabasePlugin(...)` **first** in
  the `plugins` array — every other plugin (and the global DI provider) can then
  assume a live db.

  It is closed symmetrically, by the `DatabaseShutdown` provider.
  `createServer` enables Nest's shutdown hooks, and this is the half that was
  missing — nothing ended the pool. Invisible in the shipped server (it exits
  immediately and Postgres reaps the backends) and a real leak for a host that
  **embeds** `createServer` and keeps running, which is why `createServer` hands
  the application back at all. Three details, each load-bearing:

    - **`onApplicationShutdown`, not `onModuleDestroy`.** Nest runs every
      `onModuleDestroy` first, so `OutboxDispatcher` gets to finish its
      in-flight drain before the connections underneath it are taken away.
    - **A provider, not a hook on `DatabaseModule`.** The class carries a bare
      `@Module({})` as well as its `forRoot()` dynamic form, so a plugin writing
      `imports: [DatabaseModule]` — `copilot/server` does, to document the
      dependency — gives the container a **second host for the same class**. A
      class-level hook fires once per host; a provider exists only in the
      dynamic module, so there is exactly one per app.
    - **`releaseDatabase`, not `closeDatabase`.** The pool is a *process*
      singleton and `initDatabase` is idempotent, so a second app in the same
      process shares the first's pool. An unconditional close ends the database
      underneath an app that is still answering — and since the memo is cleared
      too, the survivor fails with "Database not initialized" rather than
      anything naming the cause. `releaseDatabase` counts holders and closes for
      the last one out; `closeDatabase` keeps its unconditional meaning for a
      harness that means it.
- **Global DI.** `DatabaseModule.forRoot()` is `global: true`, so any plugin
  module can inject the db without importing it.

## Configuration

The connection string flows from `apps/server/ortha.config.ts`
(`database.url`, sourced from `DATABASE_URL`) into the plugin:

```typescript
// apps/server/src/main.ts
createServer({
    plugins: [DatabasePlugin({ connectionString: config.database.url })]
});
```

## Usage (consuming the db in a plugin)

Inject the Drizzle instance and query against tables the _consuming_ plugin
owns:

```typescript
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@ortha/database';
import { things } from '../schema';

@Injectable()
export class ThingService {
    constructor(@InjectDatabase() private readonly db: Database) {}

    findById(id: string) {
        return this.db.select().from(things).where(eq(things.id, id));
    }
}
```

Use `getDatabase()` / `getPool()` only outside Nest's DI (scripts, seeds).

## Schema & migrations

This plugin owns **one** table — `outbox_events` — and ships its own migration,
exactly like a feature plugin: `src/lib/schema/` + `drizzle.config.ts` +
committed `migrations/`, with a `migrations` descriptor on the plugin
(`__drizzle_migrations_database` tracking table) so the host applies it.
Generate per-plugin, apply from the host:

```bash
npx nx run @ortha/database:db:generate --name=<change>   # commit the SQL
npx nx run server:db:migrate                                 # applies all plugins
```

The `db:generate` target is inferred from `drizzle.config.ts` by
`@ortha/nx`; it never connects to a database.

## Not owned here

- **Feature schemas** — the outbox is the only table here. Every domain table
  belongs to its feature plugin; this package has no domain-schema knowledge.
- **Migration tooling** — the `db:generate` / `db:migrate` targets themselves
  are owned by `@ortha/nx`. The host applies every plugin's migrations.

## Commands

- `npm exec nx typecheck @ortha/database`
- `npm exec nx build @ortha/database`
- `npm exec nx test @ortha/database` — the framework-free unit specs (the
  event envelope, the connection singleton and its pool limits). Everything that
  needs a real transaction, a real pool or a real drain lives in
  `apps/server-e2e/src/server/database/` instead, because mocking a deadlock
  proves nothing.
