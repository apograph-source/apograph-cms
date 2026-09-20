# Database

_Package · packages/database_

**One connection for the whole server, and a transactional outbox underneath it**

Database is an **infrastructure** plugin: it knows not a single domain table, exposes not a single HTTP route and decides not a single business question. It does two things. First, it opens the **one and only** pool to PostgreSQL and hands it out to every other plugin. Second, it gives them a shared set of tactical primitives: the transaction boundary (`UnitOfWork`), the envelope for a fact (`DomainEvent`) and the **transactional outbox**, thanks to which an event about a change that happened can neither be lost nor outlive a rollback.

- **1** database table
- **3** migrations
- **4** tactical primitives
- **28** public exports
- **62** event kinds in the repository
- **9** publishing plugins
- **2** subscribers
- **0** HTTP routes

## Contents

- [01. Business description](#01-business-description)
- [02. Composition and place in the system](#02-composition-and-place-in-the-system)
- [03. The connection and its lifecycle](#03-the-connection-and-its-lifecycle)
- [04. Data model](#04-data-model)
- [05. Unit of Work — the contract and the rules](#05-unit-of-work-the-contract-and-the-rules)
- [06. The transactional outbox](#06-the-transactional-outbox)
- [07. The DomainEvent contract and the catalogue of kinds](#07-the-domainevent-contract-and-the-catalogue-of-kinds)
- [08. Step-by-step scenarios](#08-step-by-step-scenarios)
- [09. Configuration and environment](#09-configuration-and-environment)
- [10. Reliability and performance](#10-reliability-and-performance)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between the code and the documentation](#14-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

No CMS user ever sees Database. Its entire value lies in taking three decisions off every other plugin's hands — decisions each of them would have made differently, and diverged on.

### Why one shared access to the database

- **One pool means predictable load on the DBMS.** If every plugin opened its own connection, the number of PostgreSQL connections would grow with the number of installed plugins rather than with the number of application processes. Here there is one ceiling and it is named explicitly: `max = 10` clients per process.
- **One transaction per request.** Handing out the pool is not enough — a content write, a permissions write and the event about them must land in _one_ transaction. That is what `UnitOfWork` does: it hands out not a connection but an _executor_ — the active transaction, if there is one.
- **One way to say “this happened”.** The `DomainEvent` envelope and the `outbox_events` table are the shared language between the plugin that writes and the plugin that reacts. The publisher knows no subscribers, the subscriber knows no publishers.
- **Changing dialect is an edit in one file.** Every consumer annotates its client with the `Database` type from this package rather than the dialect-specific `NodePgDatabase`. Replacing the driver is one line here, not a tour of every plugin.

### What business problem this closes

Put without the technology: **no consequence must occur without a cause, and no cause must be left without a consequence.**

- If inviting an employee did _not_ save, the activity log must not contain an “invited” row. The event is written in the same transaction, so a rollback takes it away too.
- If the invitation saved but the log happened to be down at that moment, the row will still appear once the log comes back. The event is already in the table, waiting to be delivered.
- If a content entry saved but the alarm check failed, the save is not rolled back. The alarm will be recomputed later, and that is a deliberate trade-off: a reaction has no right to break the primary write.

> **The key architectural idea**
>
> An event is **a row in the same transaction**, not a message sent to a queue. There is no external broker in the system at all: PostgreSQL is simultaneously the state store and the outgoing-event store. Hence both the main guarantee and its price — delivery is **at least once**, so every subscriber must be idempotent.

### What Database is not

- **It is not an ORM and not a repository layer.** The package hands out the Drizzle client as it is. Repositories, mappers and aggregates live inside their own plugins (ADR-0003).
- **It is not the schema's owner.** There is not a single domain table here. Its only table of its own is `outbox_events`, and that is a _sanctioned exception_: the outbox is shared infrastructure, not any domain's data.
- **It is not a message broker.** There are no topics, no delivery ordering between aggregates, no consumer acknowledgements, no cross-process delivery over the network. There is a table and a poll.
- **It is not a migration tool.** The `db:generate` / `db:migrate` targets belong to `@orthacms/nx` and `@orthacms/cli`; there is only its own migrations descriptor here.
- **It is not a domain layer.** There is no `domain/` folder in the package and by design there should not be — this is infrastructure that domain layers _use_.

### Who sees it

#### A plugin author

Injects `@InjectDatabase()`, wraps a use case in `uow.run(...)`, and appends events through `outbox.append(...)`. There is nothing else about the database they need to know.

#### A reaction's author

Writes a class with a `kinds` field and a `handle` method and registers it with the dispatcher at application startup. Knows neither who raised the event nor when.

#### A deployment operator

Sets `DATABASE_URL` and, if needed, the pool ceiling and `statement_timeout`. Looks at “dead letters” with a query over `outbox_events`.

## 02. Composition and place in the system

The package is **flat** — `packages/database`, with no `admin`/`server` pair: it has no admin half and cannot have one. It is published as `@orthacms/database` and consumed from source (its `exports` point at `./src/index.ts`).

| File                            | What is in it                                                                | Role                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| lib/utils/db.ts                 | `initDatabase`, `getDatabase`, `getPool`, `closeDatabase`, `releaseDatabase` | The module-level connection singleton + a holder counter                  |
| lib/utils/database-plugin.ts    | `DatabasePlugin(config)`                                                     | The plugin factory: `onPluginInit`, the module, the migrations descriptor |
| lib/database.module.ts          | `DatabaseModule.forRoot()`, `DatabaseShutdown`                               | The global dynamic Nest module + the pool-closing provider                |
| lib/database.tokens.ts          | `DATABASE_TOKEN`, `InjectDatabase`                                           | Dependency-free tokens — breaking the import cycle                        |
| lib/types/index.ts              | `Database`, `DatabasePluginConfig`                                           | The single source of truth for “what a database client is”                |
| lib/events/domain-event.ts      | `DomainEvent`, `createDomainEvent`, `attachActor`, `DomainEventSubscriber`   | The fact envelope and the reactor contract. Framework-free                |
| lib/uow/unit-of-work.ts         | `UnitOfWork`                                                                 | The transaction boundary over `AsyncLocalStorage`                         |
| lib/outbox/outbox-writer.ts     | `OutboxWriter`                                                               | Writing events into the active transaction                                |
| lib/outbox/outbox-dispatcher.ts | `OutboxDispatcher`, `MAX_DELIVERY_ATTEMPTS`, `nextAttemptAfter`              | Draining the queue, delivery, retries, backoff                            |
| lib/schema/outbox-events.ts     | `outboxEvents`                                                               | The package's only table                                                  |
| migrations/                     | `0000_init`, `0001_outbox_retry_backoff`                                     | Its own SQL migrations, applied by the host                               |

### The package's dependencies

Modest and deliberate: `@nestjs/common`, `@orthacms/bootstrap-server` (only for the `ServerPlugin` type), `drizzle-orm`, `pg`. There is not, and cannot be, a single consuming plugin among the dependencies — the graph points strictly from the plugins to the database.

### Who uses what

| Primitive                 | Consumers in the repository                                                                                                                                       | Count |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| UnitOfWork / OutboxWriter | `identity/server`, `users/server`, `workspaces/server`, `content/server`, `media/server`, `transfer/server`, `segments/server`, `alarms/server`, `copilot/server` | 9     |
| OutboxDispatcher.register | `activity/server` (`AuditEventSubscriber`), `alarms/server` (`EntryEventSubscriber`)                                                                              | 2     |
| @InjectDatabase()         | practically every server plugin                                                                                                                                   | —     |
| getDatabase() / getPool() | outside DI only: the `apps/server-e2e` tests, seeders                                                                                                             | —     |

> **Its place in the plugin graph**
>
> `DatabasePlugin(...)` comes **first** in the host's `plugins` array. The comment in `apps/server/src/plugins.ts` honestly clarifies: this does not affect DI (every module is global, and `createServer` runs every `onPluginInit` before creating the Nest application — reordering was tested and the server comes up). What the order really decides is the **order in which migrations are applied**: `applyPluginMigrations` walks the array with no overarching transaction. It comes first because it is the only plugin that opens a resource in `onPluginInit` — and the moment a second one appears, the order becomes load-bearing.

## 03. The connection and its lifecycle

The connection is a **module-level singleton**: the two variables `pool` and `database` in `db.ts` plus a `holders` counter. Everything else is the rules for handling them.

### Two ways to get a client — and when to use which

There are exactly two, and they do not duplicate each other: they are meant for different worlds.

#### `@InjectDatabase()` — inside Nest

A parameter decorator over `@Inject(DATABASE_TOKEN)`. The token is provided by a `useFactory: () => getDatabase()` in a **global** dynamic module, so a plugin need not import `DatabaseModule`. This is the default: the client takes part in DI, it can be substituted in a test, and its type is annotated as `Database`.

#### `getDatabase()` / `getPool()` — outside Nest

Ordinary functions with no DI. They are needed where there simply is no container: scripts, seeders, test assertions. `getPool()` additionally hands out the _raw_ `pg.Pool` — the only way to run arbitrary SQL or to look at the pool's counters (`idleCount`, `waitingCount`, `options.max`), which the Drizzle client does not expose. Both throw if `initDatabase` has not been called yet.

**The rule for choosing.** Inside a plugin — only `@InjectDatabase()`. `getDatabase()`/`getPool()` are a deliberate step outside DI; they appear not once in the plugins' sources, and every call sits in `apps/server-e2e`. There is no third option — “take a transaction” — in this row: the transaction is handed out by `UnitOfWork.current()`, and that is precisely why a repository must not take the client directly.

> **A subtlety**
>
> `@InjectDatabase()` and `getDatabase()` return **the same object** — the provider's factory simply calls `getDatabase()`. The difference is not in the client but in who manages it. Neither of them **knows** about an active transaction: a query through them always goes past it, on a separate connection from the pool.

### Pool settings

| Parameter               | Default value | Why it is written out explicitly                                                                                                                                                                                           |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| max                     | 10            | Matches `pg`'s default, but is recorded as a decision: next to it you can see the headroom the outbox drain needs (the drain holds a client for the whole batch, and each subscriber takes its own)                        |
| connectionTimeoutMillis | 10,000        | **The important one.** `pg` sets `0` — “wait forever”. With that default an exhausted pool does not fail, it _stalls_: requests hang on a promise that will never resolve, the logs are empty, and the process looks alive |
| statement_timeout       | not set       | Deliberately off: a legitimate bulk write here can be long. It is turned on by a deployment that would rather kill a query than let it hold a client forever                                                               |

All three can be overridden through `DatabasePluginConfig`. The pool connects **lazily** — the first real connection opens on the first query, so booting the process does not require a live database.

### The lifecycle

1. **Opening — in `onPluginInit`.** `createServer` runs the hook _before_ `NestFactory.create`, so by the time any provider is constructed the connection already exists.
   _initDatabase(config) → holders = 1_
2. **A repeat call is not an opening but a join.** `initDatabase` is idempotent: if `database` already exists, it merely increments `holders` and returns. A second application in the same process shares the pool with the first — and _silently inherits its configuration_.
   _holders += 1_
3. **Handing it out.** `DatabaseModule.forRoot()` is registered globally and provides `DATABASE_TOKEN` along with the three primitives.
   _global: true_
4. **Stopping the subscribers.** Nest first runs every `onModuleDestroy` — there `OutboxDispatcher` stops the polling timer and **waits out** the drain currently in progress.
   _OutboxDispatcher.onModuleDestroy()_
5. **Releasing the claim on the pool.** Then the `DatabaseShutdown` provider's `onApplicationShutdown` fires → `releaseDatabase()`: the counter decrements, and only the last one out actually closes the pool.
   _holders -= 1; if (holders === 0) closeDatabase()_

> **Three decisions in the shutdown, each of them load-bearing**
>
> **1. `onApplicationShutdown`, not `onModuleDestroy`.** Nest's phase order — every `onModuleDestroy` first, then `onApplicationShutdown` — is what lets the dispatcher finish its batch before the connections are pulled out from under it.
>
> **2. A provider, not a hook on the module class.** `DatabaseModule` has both a bare `@Module({})` and the dynamic `forRoot()` form. A plugin that wrote `imports: [DatabaseModule]` (as `copilot/server` does, to document the dependency) gives the container **a second host of the same class** — a hook on the class would fire twice per shutdown. The provider exists only in the dynamic module, so there is exactly one per application.
>
> **3. `releaseDatabase`, not `closeDatabase`.** The pool is a _process_ singleton. Closing it unconditionally rips the database out from under an application that is still answering, and since the memo is cleared too, the survivor fails with “Database not initialized” — a message that does not name the cause. `closeDatabase` keeps its unconditional meaning for a harness that wants exactly that.

> **The trap closeDatabase closes**
>
> Ending the pool without clearing the memo is the worst of all worlds: `initDatabase` is idempotent on `database`, so the next call returns early and hands out an **ended** pool. Every query after that fails with “Cannot use a pool after calling end on the pool” — a message that names neither the culprit nor the cause. That is why `closeDatabase` nulls `pool`, `database` and `holders` _before_ the `await end()`.

## 04. Data model

One table. That is everything the package owns in the database.

### `outbox_events`

| Column          | Type        | Constraints                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id              | uuid        | PK, `DEFAULT gen_random_uuid()` | This is the envelope's `eventId`. It is also the **idempotency key**: the activity subscriber inserts its log row with the very same PK                                                                                                                                                                                                                                                                                                                                                                                            |
| kind            | text        | NOT NULL                        | What happened, as a dotted name: `workspace.created`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aggregate_type  | text        | NOT NULL                        | The aggregate root's type: `user`, `workspace`, `content_entry`…                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| aggregate_id    | text        | NOT NULL                        | The root's identifier. `text` rather than `uuid` — different contexts have different identifiers                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| payload         | jsonb       | NOT NULL                        | The fact's data. This is also where `attachActor` puts the `actor` key — now `{ id, email, type, label, via }` rather than a bare pair, see “The actor, and how it was performed” below                                                                                                                                                                                                                                                                                                                                            |
| occurred_at     | timestamptz | NOT NULL                        | **Domain** time, not delivery time. It sets the drain order                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| dispatched_at   | timestamptz | NULL until delivered            | Stamped when _every_ matching subscriber has finished                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| attempts        | integer     | NOT NULL, DEFAULT 0             | The count of failed deliveries. Read by the ceiling and by the backoff                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| next_attempt_at | timestamptz | NULL = “eligible now”           | The row is not picked up before this time. Set on every failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| last_error      | text        | NULL until a failure            | Why the most recent attempt failed, truncated to 1,000 characters. It exists so that a parked row can _answer for itself_: the row is a dead letter — an event that should have been recorded and could not be — and its parking is logged, but a log line is loud only to whoever is tailing logs at that moment. Afterwards the single question worth asking (“is anything parked, and why”) had no answer short of a `psql` session. Diagnostic text from an arbitrary subscriber, so `name: message` rather than a stack trace |

#### The indexes

```
CREATE INDEX "outbox_events_pending_idx"
  ON "outbox_events" USING btree ("occurred_at")
  WHERE "outbox_events"."dispatched_at" is null;

CREATE INDEX "outbox_events_dispatched_idx"
  ON "outbox_events" USING btree ("dispatched_at")
  WHERE "outbox_events"."dispatched_at" is not null;
```

**Two partial indexes, exact complements of each other**, one per question the table is asked.

The first serves the **drain**: a partial index on `occurred_at` over undelivered rows only. An ordinary index on `dispatched_at` (as in `0000_init`) would serve the filter and leave Postgres to sort the matches; the partial one serves the filter, the ordering and the limit _together_ and stays small — delivered rows fall out of it the moment they are stamped.

The second serves the **retention sweep**, and it is new (`0003_outbox_retention_index`). The sweep asks the one question the first index is built to exclude: delivered rows stamped before a cutoff. `0001_outbox_retry_backoff` had dropped the plain `outbox_events_dispatched_at_idx`, so until this existed a sweep would have been a sequential scan of the whole table on every pass — forever, and worst exactly on the installations that need it. It holds nothing at all until the table has a tail of delivered rows.

#### Migrations

| Tag                         | What it does                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0000_init                   | Creates the table (8 columns) and the `outbox_events_dispatched_at_idx` index                                      |
| 0001_outbox_retry_backoff   | Drops the old index, adds `next_attempt_at`, creates the partial `outbox_events_pending_idx`                       |
| 0002_outbox_last_error      | Adds `last_error`, so a parked row records why it stopped being retried                                            |
| 0003_outbox_retention_index | Adds the partial `outbox_events_dispatched_idx` over delivered rows, so the retention sweep has an index to cut on |

Tracked in their own `__drizzle_migrations_database` table, exactly as for any other plugin. Generated with `nx run @orthacms/database:db:generate --name=<change>` (with no database connection) and applied by the host through `nx run server:db:migrate`.

> **Retention, and what it deliberately cannot reach**
>
> **Delivered** rows are pruned. `OUTBOX_RETENTION_DAYS` (default 30, `0` = never) sets the window; `OutboxDispatcher.pruneDelivered(before)` does the deleting, in batches of 1,000 through a `FOR UPDATE SKIP LOCKED` sub-select, and a private `pruneIfDue` calls it at the tail of a poll tick at most once an hour. No new timer, and no bookkeeping table — the "last swept" mark is an in-process field (I-23), claimed before the sweep so two cannot overlap and **handed back if it throws**, so a failed sweep is retried on the next tick rather than buying an hour of silence.
>
> The predicate is `dispatched_at IS NOT NULL AND dispatched_at < cutoff`, and the second half of that sentence is the whole safety argument: a **pending** row and a **parked** one both carry `dispatched_at IS NULL`, so they are excluded **by construction rather than by a clause**. There is deliberately no `AND attempts < 15`; it would mean the same thing today and be the thing a later edit breaks. Nothing deletes a dead letter by age, ever — a parked row is the only evidence that something was never recorded, and a sweep that took one would make an audit gap invisible again.
>
> The cut is on `dispatched_at`, never `occurred_at`. They are different clocks: an event can occur long before it is delivered, and cutting on domain time would delete a row that went out this morning because the fact it carries is old.
>
> There is still no partitioning and no TTL in the database itself, and no uniqueness constraint over `(kind, aggregate_id)` — repeated facts about one aggregate are perfectly legal.

## 05. Unit of Work — the contract and the rules

`UnitOfWork` is the transaction boundary for a single use case. Its whole contract is three methods, and its whole trick is that the transaction is passed **implicitly**, through `AsyncLocalStorage`, rather than as a `tx` argument threaded through the entire call stack.

| Method      | What it does                                                                                                                                                             | What to keep in mind                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| run\<T>(fn) | Runs `fn` inside a transaction. If the call is **nested** (we are already inside a `run`) it is simply `await fn()`: it joins the outer transaction and opens no new one | The whole tree commits or rolls back as a unit. After the **outermost** transaction commits, the outbox drain is invoked          |
| current()   | Returns an executor: the active transaction inside a `run`, otherwise the pool's base connection                                                                         | **Does not throw** outside a `run`. That is deliberate: reading outside a unit of work is routine and should not require ceremony |
| isActive()  | Whether there is a transaction on this call tree                                                                                                                         | It exists for exactly one consumer — `OutboxWriter.append`, which must refuse to work outside a transaction                       |

### Why the check was moved out of `current()`

This is the key design decision, and it is asymmetric by intent: **reading** outside a unit of work is legitimate, **writing an event** is not. If `current()` threw outside a `run`, every simple `SELECT` in a service would have to be wrapped in a transaction. So the check is offered (`isActive()`) and _enforced by whoever needs it_.

### What happens after the commit

```
const result = await this.db.transaction((tx) => this.als.run({ tx }, fn));

// Post-commit, best-effort drain. Swallow — the poll backstop retries.
try {
    await this.dispatcher.drain();
} catch {
    // intentionally ignored; the outbox poll will pick these up
}

return result;
```

The drain is invoked **after** the commit and is **awaited** (`await`) — so under normal conditions the log row already exists by the time the response is returned. At the same time any drain error is **swallowed**: the state is already durably written, and the poll will pick the events up. A delivery failure has no right to roll back a business write — that is the entire point of the construction.

> **Observability**
>
> The `catch` block in `UnitOfWork.run` is empty: **not a single log line**. `drainOnce` itself logs the failure of each individual delivery, and `pollOnce` logs a failure of the drain as a whole, so the silence is not absolute — but a failure of the post-commit drain specifically (an inability to take a client from the pool, say) is visible only through the poll falling behind.

### Rules for use

- **The boundary is opened by the use case, not by a repository and not by a controller.** A repository must go through `uow.current()`, otherwise it will not land in the transaction — it will get the base pool and write past it.
- **A nested `run` is safe.** A use case calling another use case does not open a second transaction and does not risk deadlocking against itself.
- **`append` comes last.** Events are pulled out of the aggregate (`pullEvents()`), enriched with the actor if needed, and put into the outbox _inside_ the same `run`.
- **Do not hold a `run` around external calls.** A transaction occupies one of the pool's 10 clients; an HTTP request to an external service inside it means a held client and held locks.
- **Do not rely on subscribers' side effects inside a `run`.** The drain happens strictly after the commit, so inside the transaction the log is still empty.

## 06. The transactional outbox

The main section. The pattern's task can be put in one sentence: **record the state and the intent to announce it atomically, without having a distributed transaction**. There is no broker here and no two-phase commit — only a table in the same database and background delivery out of it.

### The numbers baked into the code

| Constant              | Value   | What it means                                                             |
| --------------------- | ------- | ------------------------------------------------------------------------- |
| DRAIN_BATCH_SIZE      | 100     | How many rows one drain takes and delivers at a time                      |
| POLL_INTERVAL_MS      | 5,000   | The backstop poll's period, in ms                                         |
| MAX_DELIVERY_ATTEMPTS | 15      | The ceiling on failed deliveries; past it the row is not picked up at all |
| RETRY_BASE_DELAY_MS   | 1,000   | The pause after the first failure; doubled thereafter                     |
| RETRY_MAX_DELAY_MS    | 300,000 | The pause ceiling — 5 minutes, a plateau beyond that                      |

### How a writer appends an event

`OutboxWriter.append(events)` — three rules and one insert:

1. **An empty array is a silent return.** No query and no error.
   _if (events.length === 0) return;_
2. **Outside a `UnitOfWork.run` — an exception.** Not a warning, not a log line, but a refusal. Outside a unit of work `uow.current()` would return the base pool, the insert would commit on its own connection, and the event would outlive a rolled-back state change — precisely what the pattern exists to prevent.
   _if (!this.uow.isActive()) throw new Error(...)_
3. **The insert goes through `uow.current()`.** Which means into the same transaction as the state change. Rows are created with `dispatchedAt: null`, `attempts: 0`; `next_attempt_at` is not set and stays `NULL`, which for the drain means “eligible right now”.
   _insert(outboxEvents).values(...)_

A row's `id` is taken from `event.eventId` rather than generated by the database. The consequence: **repeating one `eventId` within a single unit of work fails the whole unit of work** on a primary-key violation — which a dedicated e2e test checks. This is protection more than a limitation: two different facts sharing one identifier would break subscribers' idempotency.

### Two drain triggers

#### The fast path — after the commit

`UnitOfWork.run` calls `dispatcher.drain()` right after the commit and awaits it. This is the normal mode: the event is delivered before the HTTP response has even gone out to the client.

#### The backstop — a poll every 5 seconds

A `setInterval`, started in `onApplicationBootstrap` and given an `unref()` — it does not keep the process alive. It catches everything the fast path lost: a process crash between the commit and the drain, a swallowed error, a row waiting on `next_attempt_at`. A tick is guarded by the `draining` flag and is skipped if a drain is already under way.

### The mechanics of one drain (`drainOnce`)

The whole batch runs **inside one transaction** of the dispatcher's — separate from the one the event was written in.

```
SELECT * FROM outbox_events
WHERE dispatched_at IS NULL
  AND attempts < 15
  AND (next_attempt_at IS NULL OR next_attempt_at <= now)
ORDER BY occurred_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Three selection conditions, each carrying its own meaning: `dispatched_at IS NULL` — not yet delivered; `attempts < 15` — not a “dead letter”; `next_attempt_at` — the backoff pause has elapsed. Ordering is by **domain** time, the limit is 100, and there is a `FOR UPDATE SKIP LOCKED`.

Then, for each row in order:

1. **Reconstructing the envelope.** The row is unfolded back into a `DomainEvent`: `eventId = row.id`, and `payload` is cast to `Record<string, unknown>`. Note: `attempts` and `nextAttemptAt` do **not** make it into the envelope — a subscriber does not know which attempt this is.
   _row → DomainEvent_
2. **Selecting subscribers.** `subscribersFor(kind)` combines the statically injected ones (the `DOMAIN_EVENT_SUBSCRIBERS` token, an empty array by default) with those registered at runtime, and filters by `kinds === '*' || kinds.includes(kind)`.
   _injected ++ registered_
3. **Sequential delivery.** Subscribers are called in an `await` loop, one after another. There is no parallelism — deliberately: each takes its own client from a pool of 10.
   _for (const s of subs) await s.handle(event)_
4. **Success — the stamp.** If _every_ subscriber finished without throwing, the row is stamped `dispatched_at = now` in the drain's own transaction.
   _UPDATE ... SET dispatched_at = now_
5. **Failure — the counter and the pause.** The very first exception aborts delivery of that row (the event's remaining subscribers are not called on this attempt). An `error`-level log line is written, then `attempts += 1` and `next_attempt_at = nextAttemptAfter(attempts, now)`. The row stays `dispatched_at IS NULL`.
   _UPDATE ... SET attempts, next_attempt_at_
6. **The next row.** One row's failure does not abort the batch — the loop moves on. One bad subscriber does not block other people's events.
   _continue_

### Backoff: why the ceiling means nothing without it

```
export function nextAttemptAfter(attempts: number, now: Date): Date {
    const delay = Math.min(1_000 * 2 ** (attempts - 1), 5 * 60_000);
    return new Date(now.getTime() + delay);
}
```

The drain is triggered by _commits_, and on a busy server commits come back to back. A ceiling of 15 attempts without pauses would be spent in milliseconds, and a subscriber unavailable for a single instant would find all of its events already “dead” by the time it came back.

| Failure # | Pause before the next attempt | Failure # | Pause before the next attempt                           |
| --------- | ----------------------------- | --------- | ------------------------------------------------------- |
| 1         | 1 s                           | 9         | 256 s                                                   |
| 2         | 2 s                           | 10        | 300 s (plateau)                                         |
| 3         | 4 s                           | 11        | 300 s                                                   |
| 4         | 8 s                           | 12        | 300 s                                                   |
| 5         | 16 s                          | 13        | 300 s                                                   |
| 6         | 32 s                          | 14        | 300 s                                                   |
| 7         | 64 s                          | 15        | the row is parked                                       |
| 8         | 128 s                         | —         | ≈ 33 minutes in total before it becomes a “dead letter” |

A unit test pins this down as a range rather than an exact number: the sum of the pauses is more than 20 and less than 60 minutes — “about half an hour”. And it is separately checked that a pause is never negative: `nextAttemptAfter(n, now) > now` for every `n` from 1 to 15.

### The attempt ceiling: why it exists at all

> **The defect the ceiling closed**
>
> Without a ceiling the `attempts` field was written and **never read**. The selection is `ORDER BY occurred_at LIMIT 100`, so a row whose subscriber can never succeed was re-selected on every tick forever. Let a hundred such rows accumulate and they permanently occupied the head of the queue: **no new event was ever delivered again**. The ceiling parks the row and lets the queue move on.

**dispatched_at IS NULL, attempts = 0** → **attempts 1…14, waiting on next_attempt_at** → **dispatched_at = now**

**attempts 1…14** → **attempts ≥ 15 — a dead letter, never picked up** → **an operator zeroed attempts — back in the queue**

**The dead-letter query** — the same predicate as in the code, and now also as a method:

```
-- have a look
SELECT id, kind, aggregate_type, aggregate_id, attempts, last_error, occurred_at
FROM outbox_events
WHERE dispatched_at IS NULL AND attempts >= 15
ORDER BY occurred_at DESC;

-- replay, once the cause has been fixed
UPDATE outbox_events SET attempts = 0, next_attempt_at = NULL
WHERE id = '...';
```

`OutboxDispatcher.deadLetters({ limit, newerThan })` is that query as a method, returning `{ total, items }` — `total` separate from `items` so a caller can render “3 events could not be recorded” without paging. The payload is deliberately left out of a `DeadLetter`: it is arbitrary domain data, some of it user-authored, and the caller is an operator asking _what_ is stuck rather than replaying it.

> **Why this stopped being SQL-only**
>
> A parked row is very often an **audit row that was never written**, and a hole in an audit trail that is only visible to somebody who thinks to run a query is barely a hole that has been noticed. So `@orthacms/activity-server` serves this method at `GET /api/activity/dead-letters` under `activity:read`, and its admin page renders a non-zero `total` as a notice above the log — on the page whose whole job is being the record of record.
>
> The **read** route reports; `POST /api/activity/dead-letters/:id/retry` performs the `UPDATE` above through `OutboxDispatcher.retryDeadLetter` (I-26), under `activity:manage` rather than `activity:read`. That it is no longer a `psql` session does not make it a button that re-runs whatever failed fifteen times: it takes one id at a time, the operator has `lastError` in front of them, and a reset row rejoins an `ORDER BY occurred_at` claim at the head — which is right for one row and a way to stall the queue for a hundred. Database owns the query, the column and the mechanism; it owns no HTTP route, here as everywhere.

### Concurrency: one drain per process, many processes side by side

#### Between processes — `SKIP LOCKED`

Two server replicas take **disjoint** sets of rows and do not block each other. Horizontal scaling requires neither a leader nor coordination.

#### Within a process — call coalescing

`drain()` holds at most two drains: the active one and **one** queued. Everyone who arrives while the active one is running joins that same deferred drain. It starts after all of them have committed — so each still gets its guarantee that “my rows were drained before the `await` returned”, but without one drain per caller.

> **Why it cannot be otherwise**
>
> A drain holds a pool client **for the whole batch**, and every subscriber it calls takes one of its own. Start enough drains at once and the entire pool of 10 clients is occupied by drains, each waiting for a client that will never be freed. A deadlock **with no timeout, no log line and no recovery**, reproducibly reachable from a dozen parallel requests on top of an accumulated queue. Hence both the “one drain per process” rule and a dedicated e2e test asserting `getPool().waitingCount === 0`.

### The guarantees — and what is not guaranteed

| Property                                    | Present?                      | How it is ensured                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomicity of the event and the state change | yes                           | One transaction; `append` outside a `run` is forbidden by an exception                                                                                                            |
| At-least-once delivery                      | yes                           | The row is not stamped until every subscriber has finished; on failure it is retried                                                                                              |
| Exactly-once delivery                       | no                            | A subscriber's side effect commits on _its own_ connection, while the `dispatched_at` stamp lands in the drain's transaction. The gap between them is precisely a repeat delivery |
| Subscriber idempotency                      | not guaranteed by the package | A requirement on the subscriber's author. Both shipped subscribers honour it                                                                                                      |
| Delivery order                              | partly                        | Within one batch, by `occurred_at`. Between batches, across replicas and after a failure with a pause — not guaranteed                                                            |
| Delivery after the attempts are exhausted   | no                            | The row is parked. A manual retry means zeroing `attempts`                                                                                                                        |
| Durability across a process shutdown        | yes                           | `onModuleDestroy` waits out the in-flight drain — at most one batch                                                                                                               |

### Idempotency in practice

The idempotency key is the `eventId`, which is also the outbox row's PK. How the two shipped subscribers use it:

- **`activity/server`, `AuditEventSubscriber`.** The log row's primary key is the `event.eventId`, and the insert carries `ON CONFLICT DO NOTHING`. A repeat delivery creates no second audit record.
- **`alarms/server`, `EntryEventSubscriber`.** Its idempotency is structural: a finding is upserted on the `(rule_id, entry_id)` key, and the deletion and closing paths are set operations that a repeat changes nothing about.

Worth calling out separately is the distinction the audit mapper draws: `null` means “not our event, skip it” and the row is marked delivered; an **exception** means “this event should have reached the audit log but cannot” — the row stays undelivered, goes into retries with backoff and is eventually parked as a dead letter rather than turning into a record nobody will be able to read.

## 07. The DomainEvent contract and the catalogue of kinds

The envelope is deliberately poor: six fields and zero framework dependencies. Any layer can build one, including `domain/`, which under ADR-0003's rule is forbidden to see Nest and Drizzle.

| Field         | Type                     | Filled by                         | Purpose                                                              |
| ------------- | ------------------------ | --------------------------------- | -------------------------------------------------------------------- |
| eventId       | string (uuid)            | `createDomainEvent`, if not given | The idempotency key for at-least-once delivery                       |
| kind          | string                   | the caller                        | The fact's dotted name: `entry.published`                            |
| aggregateType | string                   | the context's helper              | The aggregate root's type                                            |
| aggregateId   | string                   | the context's helper              | The root's identifier                                                |
| occurredAt    | Date                     | `createDomainEvent`, if not given | Domain time. **Not** dispatch time                                   |
| payload       | Record\<string, unknown> | the caller                        | The fact's data. Must be JSON-serialisable — it is stored as `jsonb` |

### `attachActor` — why the actor travels inside the event

An aggregate knows _what_ happened but not _who_ did it: the request's user is an application-layer notion, not part of the domain model. The audit log needs both. `attachActor(events, actor)` solves that by touching the one part of the envelope that survives the round trip through the outbox — the `payload`:

```
export function attachActor(events: DomainEvent[], actor: EventActor): DomainEvent[] {
    return events.map((event) => ({
        ...event,
        payload: {
            ...event.payload,
            actor: {
                id: actor.id,
                email: actor.email,
                type: actor.type ?? EVENT_ACTOR_TYPE.User,
                label: actor.label ?? null,
                via: actor.via ?? null
            }
        }
    }));
}
```

- **It does not mutate the input events** — it returns copies.
- **The call site** is the application service, between `aggregate.pullEvents()` and `outbox.append(...)`. It is the only layer that knows both the events and the request's actor.
- **The `email` is a _snapshot_** (`string | null`), not a reference. The audit log must still be readable after the account has been renamed or deleted.
- **The `actor` key is overwritten** if the publisher had already put something under it: the application layer's actor wins. That is pinned down by a unit test.
- The audit subscriber pulls it back out as `payload.actor` and unpacks it into `actorId` / `actorType` / `actorEmail`; a missing key yields `null` — “a system event”.

#### The actor, and how it was performed

An actor used to be a pair, `{ id, email }`, and that carried an unstated assumption: `id` meant a `users` row. A write made with an API token therefore had to pass **no actor at all** rather than name a person who did not do it — so every write over the public REST API, GraphQL and MCP reached the audit log as “System”, and which of a workspace's tokens did it was unrecoverable from anywhere. Three fields fix that, and they answer three different questions:

| Field | Question                                          | Notes                                                                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type  | **What kind** of principal `id` names             | `EVENT_ACTOR_TYPE.User` or `.ApiToken`. Omitted means `user` — every actor predates the field except the token ones that introduced it, so the default is a statement of fact rather than a guess                                                                                                                                |
| label | **What to call** a principal that is not a person | An API token's name. `email` is the readable name for a user and a token has none, so without this a token-actored row would show an id and nothing legible                                                                                                                                                                      |
| via   | **How** it was performed, when not by hand        | An open `{ kind, …ids }`. A copilot proposal applies under the authority of the human who accepted it — so the actor is correctly that person — but without this the row was indistinguishable from one they typed. Two mechanisms use it: `copilot` (with `runId`, `proposalId`) and `revision_restore` (with `revisionNumber`) |

> **The one thing a consumer must not do with it**
>
> A token's `id` is an `api_tokens` row, and some consumers write an actor into a column that really is a `users` foreign key — `content_entry_revisions.created_by`, for one. Naming a credential in the _audit_ path is now correct; putting it in a revision's authorship would make every version resolve to a nonexistent person. The two answers are separated at the consumer (content's `revisionActorId` yields a user id or nothing), not here: this package states who acted, and each consumer decides which of its columns that is allowed to fill.

### The subscriber contract

```
export interface DomainEventSubscriber {
    readonly kinds: readonly string[] | '*';
    handle(event: DomainEvent): Promise<void>;
}
```

Registration happens **at runtime**, from the plugin's own `OnApplicationBootstrap`: inject `OutboxDispatcher` and call `register(this)`. The reason is technical and stated in the code: Nest cannot merge a multi-provider token across independent dynamic modules. The `DOMAIN_EVENT_SUBSCRIBERS` token remains (defaulting to `[]`) for subscribers placed statically alongside, and is merged with those registered at runtime.

### The catalogue of event kinds across the repository

The `database` package **defines no kinds at all** — it defines only the envelope. Kinds belong to the contexts. As of the current branch there are **62** of them across nine publishing plugins. The full catalogue, with each kind's meaning and payload, is in the [Activity dossier](activity.html) — the sink is where it is worth reading, since a kind matters only where somebody consumes it.

| Context             | aggregateType              | Kinds | Kinds                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity/server`   | user, api_token            | 14    | `user.activated`, `user.disabled`, `user.enabled`, `user.password_changed`, `user.session_revoked`, `user.sso_linked`, `user.sso_provisioned`, `user.sso_role_mapped`, `auth.signed_in`, `auth.signed_out`, `auth.sign_in_failed`, `api_token.created`, `api_token.revoked`, `api_token.used` |
| `workspaces/server` | workspace                  | 9     | `workspace.created`, `.updated`, `.archived`, `.unarchived`, `.deleted`, `.member_added`, `.member_removed`, `.content_granted`, `.content_revoked`                                                                                                                                           |
| `users/server`      | member                     | 8     | `member.invited`, `.invite_resent`, `.password_reset_issued`, `.profile_updated`, `.role_changed`, `.disabled`, `.reactivated`, `.removed`                                                                                                                                                    |
| `media/server`      | media.asset, media.folder  | 7     | `media.asset.uploaded`, `.updated`, `.moved`, `.deleted`, `media.folder.created`, `.renamed`, `.deleted`                                                                                                                                                                                      |
| `content/server`    | content_entry, saved_view  | 10    | `entry.created`, `.updated`, `.published`, `.unpublished`, `.deleted`, `.restored`, `.purged`; `saved_view.created`, `.updated`, `.deleted`                                                                                                                                                   |
| `transfer/server`   | transfer.content           | 2     | `transfer.content.exported`, `transfer.content.imported`                                                                                                                                                                                                                                      |
| `segments/server`   | segment, content_entry     | 4     | `segment.created`, `.updated`, `.deleted`, `segment.entry_access_changed`                                                                                                                                                                                                                     |
| `alarms/server`     | alarm_rule                 | 4     | `alarm.rule.created`, `.updated`, `.deleted`, `.rescanned`                                                                                                                                                                                                                                    |
| `copilot/server`    | copilot_skill, copilot_run | 4     | `copilot.skill.created`, `.updated`, `.deleted`, `copilot.tool_permission.decided`                                                                                                                                                                                                            |

### Who listens to these kinds

| Subscriber                              | kinds    | What it does                                                                                     | Idempotency                                             |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| activity/server<br>AuditEventSubscriber | 20 kinds | Turns an event into an `activity_events` row — the audit log's only live writer                  | PK = `eventId`, insert with `ON CONFLICT DO NOTHING`    |
| alarms/server<br>EntryEventSubscriber   | 7 kinds  | Recomputes an entry's alarm findings and makes a reverse pass over the entries that reference it | An upsert on `(rule_id, entry_id)`, plus set operations |

The 20 audited kinds are the keys of the mapper table in `audit-event-mapping.ts`: nine `workspace.*`, eight `member.*`, plus `user.password_changed`, `user.activated` and `auth.signed_in`. The audit catalogue is **deliberately separate** from the domain-event catalogue: the subscriber _maps_ one set of names onto another rather than reusing them — which is why `member.removed` becomes `user.invite_revoked`, and `member.disabled` becomes `user.suspended`.

> **A consequence worth knowing**
>
> About half of the 44 kinds are listened to. The rest — `api_token.*`, `user.sso_*`, `auth.signed_out`, `user.disabled`/`enabled`, all the `media.*`, all the `transfer.*` — are written to the outbox and **immediately marked delivered**, because the number of matching subscribers is zero. That is neither a loss nor a bug: the row stays in the table as a fact, and a new subscriber can appear without a single edit to the publisher. But nobody is receiving “messages” from it today either.

## 08. Step-by-step scenarios

### Scenario A. A plugin records a change and an event

Example: an administrator changes a member's role.

1. **The controller calls the use case.** There is no transaction yet, and `uow.isActive()` would return `false`.
2. **The use case opens a unit of work.** `await this.uow.run(async () => { ... })` — Drizzle opens a transaction and its executor is placed into `AsyncLocalStorage`.
   _BEGIN_
3. **The repository loads the aggregate.** Through `uow.current()`, so already inside the transaction. No `tx` in any signature.
4. **The aggregate applies the rule and raises a fact.** `member.changeRole(...)` checks the invariant and accumulates the event inside itself.
5. **The repository saves.** Also through `uow.current()` — the same transaction.
6. **The use case pulls the events and adds the actor.** `attachActor(member.pullEvents(), actor)` — the `payload` now carries an `actor`.
7. **The write into the outbox.** `await this.outbox.append(events)`: `isActive()` is true, so the insert goes into the same transaction.
   _INSERT INTO outbox_events (dispatched_at = NULL, attempts = 0)_
8. **The commit.** The state and the event become visible at the same moment — or not at all.
   _COMMIT_
9. **The post-commit drain.** `run` calls `dispatcher.drain()` and awaits it. A drain error is swallowed.
10. **The response.** Under normal conditions the log row already exists by the time the HTTP response goes out.

**The rollback branch:** if step 5 or 7 throws, the transaction rolls back and _the event disappears along with the change_. A dedicated e2e test checks exactly that.

### Scenario B. The dispatcher delivers an event

1. **The trigger.** Either the post-commit `drain()` or a poll tick every 5 s.
2. **Coalescing.** If a drain is already running, the caller joins the single deferred drain and no new one is created.
3. **Claiming rows.** The dispatcher's transaction opens; up to 100 rows are taken `FOR UPDATE SKIP LOCKED`, the oldest by `occurred_at`, with `dispatched_at IS NULL`, `attempts < 15` and `next_attempt_at` reached.
   _another process will take different rows at the same moment_
4. **Reconstructing the envelope** from the row: `eventId`, `kind`, `aggregateType`, `aggregateId`, `occurredAt`, `payload`.
5. **Filtering subscribers** by `kind`: the injected ones plus the registered ones whose `kinds` matched or equals `'*'`.
6. **Sequential calls** to `handle(event)`. Each subscriber takes its own client from the pool; the drain holds its own throughout.
7. **The stamp.** All finished — `dispatched_at = now` in the drain's transaction.
8. **The next row** of the batch, and so on to the end. Then the drain's transaction commits.
   _COMMIT_

### Scenario C. A subscriber fails

1. **An exception in `handle`.** The loop over that row's subscribers is aborted — the event's remaining subscribers are not called on this attempt.
2. **The log.** An `error` with a stack: “Delivery failed for event \<id> (\<kind>); will retry”.
3. **The counter and the pause.** `attempts += 1`, `next_attempt_at = now + min(1000 · 2^(attempts−1), 300000)`. `dispatched_at` stays `NULL`.
4. **The batch continues.** The following rows are delivered normally — a failing subscriber does not block other people's events.
5. **The retry.** After the pause, the next drain — post-commit or poll — picks the row up.
6. **On the 15th failure — parking.** The log changes: “giving up”, naming the dead-letter query. The row no longer enters the selection and no longer holds up the queue, and `last_error` holds the reason it stopped — so the row can be read afterwards without the log line that announced it.
   _≈ 33 minutes from the first failure_
7. **Recovery is manual.** The operator fixes the cause and zeroes `attempts` (and, if they wish, `next_attempt_at`). There is no automatic resurrection.

> **An important consequence for subscriber authors**
>
> A retry restarts the row's delivery **from the first subscriber**. If two listen to the event and the second one fails, the first will receive it again. This is exactly the case the idempotency requirement is written into the contract for, rather than into the recommendations.

### Scenario D. An event nobody listens to

1. **The publisher writes it as usual** — it does not know and does not ask whether there are subscribers.
2. **The drain picks the row up** like any other.
3. **`subscribersFor(kind)` returns an empty array.** The delivery loop does not execute once.
4. **The row is stamped immediately** with `dispatched_at = now`: formally “delivered to everyone who was waiting for it”, and nobody was.
   _attempts stays 0_
5. **The row stays in the table forever** as a historical fact. A new subscriber added tomorrow will **not** see it — it is already stamped.

The comment in `identity-events.ts` puts it outright: “Emitting these to the outbox is harmless until that subscriber exists (no subscriber ⇒ the rows auto-mark dispatched)”. That is, publishing events ahead of time is cheap and safe, but it is **not** a deferred-subscription mechanism: there is no rewind.

### Scenario E. The process stops mid-drain

1. **`SIGTERM`.** `createServer` enabled Nest's shutdown hooks, and the HTTP server stops accepting connections.
2. **The `onModuleDestroy` phase.** `OutboxDispatcher` stops the poll interval, then `await`s `queued ?? active` — that is, it waits out both the deferred and the active drain. Both promises are swallowed: throwing from here would derail the rest of the shutdown.
   _at most one batch — the selection is capped at 100 rows_
3. **The `onApplicationShutdown` phase.** `DatabaseShutdown` calls `releaseDatabase()`; the last holder closes the pool. An exception here is not let out either — only logged.

Before this fix, a drain caught by `SIGTERM` died mid-batch along with its connection: subscribers that had already finished were not marked delivered, and the events were replayed on the next start. The at-least-once guarantee makes that legal, and the single shipped subscriber is idempotent — but there is no reason to spend the guarantee on a planned shutdown.

## 09. Configuration and environment

The plugin's configuration is one required parameter and three optional ones. The package reads no environment variables at all: `apps/server/ortha.config.ts` is the only place that touches `process.env`, and it hands the plugin an already-typed value.

| `DatabasePluginConfig` field | Required | Default | Comment                                                                                |
| ---------------------------- | -------- | ------- | -------------------------------------------------------------------------------------- |
| connectionString             | yes      | —       | The PostgreSQL connection string. In the host it is `config.database.url`              |
| poolMax                      | no       | 10      | The client ceiling. It must leave headroom for the outbox drain                        |
| connectionTimeoutMillis      | no       | 10,000  | How long to wait for a free client. Zero would mean “forever” — which is why it is set |
| statementTimeoutMillis       | no       | off     | Passed to `pg` as `statement_timeout` for every pool session                           |

### The environment

| Variable     | Who reads it                                                                                 | Example                                                    |
| ------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| DATABASE_URL | `ortha.config.ts`, through `requireEnv` — mandatory; without it the server does not start | postgresql://ortha:ortha@localhost:5432/ortha_cms |

`poolMax`, `connectionTimeoutMillis` and `statementTimeoutMillis` have **no environment variables** — today they are literals in the host's code, if it sets them at all. A deployment that needs a different pool ceiling will have to edit `ortha.config.ts` or its own composition root.

### Wiring it up in the host

```
// apps/server/src/plugins.ts
return [
    DatabasePlugin({ connectionString: config.database.url }),
    IdentityPlugin(...),
    WorkspacesPlugin(...),
    ...
];
```

### Parallel stacks

Several working copies share **one** Postgres container — isolation comes from `CREATE DATABASE`, not from five containers that would not fit in memory. Slot _n_ fixes the API on `:300n`, the admin UI on `:420n` and the database `ortha_cms_an`; `npm run worktree -- provision <slot>` creates the database and writes a `.env` with the right `DATABASE_URL`. None of this changes anything for the package — it only ever sees a connection string.

### Commands

| Command                                                | What it does                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| nx run @orthacms/database:db:generate --name=\<change> | Generates an SQL migration from `src/lib/schema/index.ts`. It **does not connect** to the database — it only diffs against a snapshot |
| nx run server:db:migrate                               | Applies _every_ plugin's migrations, in the host array's order, each into its own tracking table                                      |
| nx test @orthacms/database                             | Unit specs without a database: the event envelope, the connection singleton, the backoff, the promise ordering at shutdown            |
| nx typecheck / build @orthacms/database                | Type checking and building                                                                                                            |

## 10. Reliability and performance

### The pool budget

10 clients per process is _everything_ the application has. The outbox drain spends them asymmetrically:

| Consumer                                | How many clients | For how long                                                   |
| --------------------------------------- | ---------------- | -------------------------------------------------------------- |
| An ordinary query outside a transaction | 1                | For the duration of the query                                  |
| `UnitOfWork.run`                        | 1                | For the whole unit of work, nested calls included              |
| `drainOnce`                             | 1                | **For the whole batch** — up to 100 events                     |
| Every subscriber inside a drain         | 1                | For the duration of its `handle`, on top of the drain's client |

Hence the “one drain per process” rule, and hence the requirement on `poolMax`: lowering it below roughly 4 is dangerous — the drain plus a subscriber plus the request being served already take three.

### What happens when the pool is exhausted

**free clients available** → **queued, up to 10 s** → **a “timeout” error on one request**

The key point is that the right-hand transition exists at all. With `pg`'s default (`0`) it would not: the queue would grow without bound, no error would ever surface, and the process would look healthy to any outside observer. An e2e test occupies all 10 clients and checks that the eleventh request fails, and fails _roughly after the configured time_ rather than at once — that is, that this is a bounded wait and not a refusal. A second test checks the converse: the queue starts being served the moment a client is returned.

### The cost of a drain

- **The selection is cheap.** The partial index covers the filter, the ordering and the limit; delivered rows drop out of it, so its size is determined by the queue's length, not by the table's size.
- **The batch is capped at 100.** That is also the shutdown wait's bound and the drain transaction's bound.
- **Delivery is sequential.** With a slow subscriber, a batch of 100 events takes 100 of its calls back to back — and holds a client for all of that time.
- **The poll is lazy.** A tick every 5 s issues one `SELECT`, which on an empty queue is nearly free; a tick is skipped if a drain is already running.
- **An `unref()` on the timer** — the background poll does not stop the process from exiting.

### Lag and monitoring

The package publishes no metrics — no counters, no health check, no route. All observation comes down to SQL and logs:

```
-- queue depth and the age of the oldest undelivered event
SELECT count(*) AS pending,
       min(occurred_at) AS oldest,
       count(*) FILTER (WHERE attempts >= 15) AS dead_letters,
       count(*) FILTER (WHERE attempts BETWEEN 1 AND 14) AS retrying
FROM outbox_events
WHERE dispatched_at IS NULL;
```

The dispatcher's logs: `Delivery failed for event <id> (<kind>); will retry` on every failure, a distinct “giving up” wording on the fifteenth, and `Outbox poll drain failed` when a poll tick fails as a whole.

### Running multiple processes

Several server replicas work the same queue correctly and without configuration: `FOR UPDATE SKIP LOCKED` hands them disjoint rows. The “one drain at a time” restriction is **per process** and does not extend across replicas. The flip side: delivery order between replicas is undefined, and the total load on the pool grows linearly with the number of replicas.

> **Known rough edges**
>
> **Retention only reaches delivered rows — by design, and it is worth knowing.** The sweep removes rows stamped `dispatched_at` before the cutoff; pending and parked rows are never removed by age. So an installation whose subscriber is permanently broken still accumulates dead letters without bound, and the answer is to fix the cause and retry them, not to widen the sweep. A deployment that sets `OUTBOX_RETENTION_DAYS=0` is back to the old behaviour — monotonic growth — deliberately.
>
> **The sweep is per process and in memory.** `lastPrunedAt` is a field, so N replicas each sweep hourly (harmless — `SKIP LOCKED`, and the second one finds nothing), and a process restarted every few minutes never sweeps at all.
>
> **There is no limit on `payload` size.** It is `jsonb`; an excessively large payload is paid for on every drain.
>
> **One slow subscriber slows everybody down.** Delivery is sequential both within an event and within a batch.

## 11. Invariants

Statements that must remain true. Violating any of them is a defect, not a change of behaviour.

- **I-01** — There is **exactly one** pool and one Drizzle client per process. `initDatabase` is idempotent: a repeat call does not open a second pool, it increments the holder counter.
- **I-02** — `getDatabase()` and `getPool()` before `initDatabase` **throw with an intelligible message** rather than returning `undefined`.
- **I-03** — The pool is always opened with **explicit** `max` and `connectionTimeoutMillis`; the latter is strictly greater than zero. Exhausting the pool must produce an error on one request, not an unbounded wait for all of them.
- **I-04** — The pool is closed by the **last** holder to leave. An application shutting down while a neighbour in the same process is alive does not take the database away from it.
- **I-05** — `closeDatabase` clears the memo _before_ ending the pool: afterwards `initDatabase` opens a genuinely new pool rather than handing out an ended one.
- **I-06** — The shutdown hook **never** lets an exception out — the error is only logged and the rest of the shutdown runs.
- **I-07** — A nested `UnitOfWork.run` **joins** the outer transaction and never opens a new one.
- **I-08** — `uow.current()` outside a `run` returns the base connection and does **not** throw — reading outside a unit of work is legitimate.
- **I-09** — `OutboxWriter.append` outside a `UnitOfWork.run` **throws**. An event cannot be written on a separate connection.
- **I-10** — An event commits **if and only if** the state change that raised it commits. A rollback takes the events with it.
- **I-11** — `append` with an empty array is a silent no-op: no query and no error.
- **I-12** — Repeating one `eventId` within a unit of work **fails the whole unit of work** — the `eventId` is the outbox row's primary key.
- **I-13** — A post-commit drain failure **never** rolls back the state change — the exception is swallowed and the poll picks the event up.
- **I-14** — A row is stamped `dispatched_at` only after **every** matching subscriber has finished without throwing.
- **I-15** — One subscriber's failure increments `attempts` and sets `next_attempt_at`, leaving the row undelivered; **the batch's other rows are delivered normally**.
- **I-16** — A row with `attempts ≥ 15` no longer enters the selection — a full batch of “poisoned” rows **cannot** block the head of the queue.
- **I-17** — `nextAttemptAfter(n, now) > now` for every `n`; the delay doubles from 1 second and plateaus at 5 minutes.
- **I-18** — Within a process, **no more than one** drain runs at a time, plus at most one deferred. The pool cannot be exhausted by drains.
- **I-19** — Drains in **different processes** take disjoint rows and do not block each other (`FOR UPDATE SKIP LOCKED`).
- **I-20** — `onModuleDestroy` waits out the in-flight drain and throws no exception; the wait is bounded by one batch.
- **I-21** — An event with no subscribers at all is marked delivered **immediately**, with `attempts = 0`.
- **I-22** — `attachActor` does not mutate the input events, puts the actor under the `actor` key and **overwrites** an actor placed there by the publisher.
- **I-23** — The package owns exactly **one** table. A second one appearing is a change of architectural decision, not a routine edit.
- **I-24** — There is no `domain/` module in this package and none should appear: this is infrastructure.
- **I-25** — The retention sweep deletes **only** rows with `dispatched_at IS NOT NULL` stamped before the cutoff. A pending row and a **parked** row are excluded by that predicate itself, not by a clause about `attempts`, and no retention setting can reach either. The cut is on `dispatched_at`, never `occurred_at`.
- **I-26** — A retry resets the existing row **in place** — `attempts = 0`, `next_attempt_at = NULL`, `last_error` preserved — and never enqueues a copy. Both columns are cleared together: clearing `attempts` alone leaves a row the claim predicate still refuses. An already-delivered row cannot be retried, and is reported indistinguishably from an unknown one.

## 12. Testing checklist

The split of checks is fixed in the package itself and is worth honouring: no framework and no database — those are the unit specs here; everything that needs a real transaction, a real pool or a real drain goes into `apps/server-e2e/src/server/database/`, “because a mocked deadlock proves nothing”.

### The connection and the pool

- **Call `getDatabase()` before `initDatabase`** → an exception reading “Database not initialized”, not `undefined`.
- **Check `getPool().options`** → `max = 10`, `connectionTimeoutMillis = 10000`, and strictly greater than zero.
- **Pass your own `poolMax` / `connectionTimeoutMillis` / `statementTimeoutMillis`** → they reach the pool; `statement_timeout` is absent when not set.
- **Occupy all 10 clients and issue an eleventh query** → a “timeout” refusal after roughly 10 seconds — neither instantly nor never.
- **Release a client while the queue is waiting** → the waiting query is served immediately.
- **Call `initDatabase` twice with different configs** → the pool stays the first one, and the second config is **silently** ignored.
- **Shut down one of two applications in the process** → the pool is alive and the second application keeps answering.
- **Shut down the last application** → the pool is closed, the memo cleared, and the next `initDatabase` opens a new pool.
- **Fire a stray shutdown hook after closing** → a no-op; a closed pool does not “resurrect”.
- **Make `releaseDatabase` fail** → the hook logs and does not throw.

### Unit of Work and writing to the outbox

- **A nested `run` inside an outer one** → one transaction for the whole tree; no second `BEGIN` is issued.
- **Throw after `append`** → both the state change and the outbox rows are rolled back — the table holds nothing.
- **A successful unit of work** → the change and the events become visible at the same moment.
- **`append([])`** → a no-op; no query is sent.
- **The same `eventId` twice in one unit of work** → the whole unit of work is rejected (a PK violation).
- **`append` outside a `run`** → an exception; the row does **not** appear in the table.
- **`isActive()` and `current()` outside a `run`** → `false` and the base connection, respectively.

### The dispatcher: delivery, retries, concurrency

- **A queue longer than a batch** → the oldest by `occurred_at` are taken, no more than 100, and it is exactly those that get stamped.
- **A narrow subscriber and a `'*'` subscriber** → the narrow one receives only its kinds and `'*'` receives all of them; each once per registration.
- **A subscriber throws** → `attempts = 1`, `dispatched_at` stays `NULL`, and `next_attempt_at` is in the future.
- **Repeated drains back to back with a failing subscriber** → the attempts are **not** burned in one go — the row is not picked up until the pause has elapsed.
- **Drive `attempts` to 15** → the row is no longer selected; the log contains “giving up” and the dead-letter query.
- **A full batch of “poisoned” rows plus a fresh event** → the fresh one is delivered — the head of the queue is not blocked.
- **Many parallel `drain()` calls** → at most two drains ran (the active one + the deferred one), not one per caller.
- **A dozen parallel units of work on top of an accumulated queue** → the pool is not deadlocked: `getPool().waitingCount === 0`, and subscribers that take their own connection complete.
- **Call nothing and wait** → the poll picks the row up by itself within 5 seconds.
- **An event of a kind nobody listens to** → the row is stamped at once, `attempts = 0`.
- **Shutdown during a drain** → `onModuleDestroy` waits for the active and the deferred drain; it does not throw when a drain fails; with no drain running it returns immediately.
- **Re-delivery of the same event** → the audit subscriber creates no second row (`ON CONFLICT DO NOTHING`).

### The event envelope

- **`createDomainEvent` without an `eventId`/`occurredAt`** → filled with a fresh uuid and the current time; two consecutive events have different ids.
- **With explicit `eventId`/`occurredAt`** → preserved verbatim.
- **`attachActor`** → the input objects are unmodified; `email: null` is preserved as a key rather than dropped; the rest of the envelope is untouched; an empty array yields an empty array.

### Migrations

- **`db:migrate` on a clean database** → the `outbox_events` table, the partial `outbox_events_pending_idx` index, and tracking in `__drizzle_migrations_database`.
- **A repeat `db:migrate`** → nothing is applied and there are no errors.
- **`db:generate` with no database running** → it works — generation only diffs the schema against a snapshot.

## 13. Boundaries of responsibility

The package is deliberately narrow. Everything that could be handed outwards has been.

| Question                                                 | Here? | Where it really lives                                                                 |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| Opening a connection and handing it out                  | yes   | —                                                                                     |
| The transaction boundary, the event envelope, the outbox | yes   | —                                                                                     |
| The `outbox_events` table and its migrations             | yes   | A sanctioned exception to “a plugin does not own someone else's schema”               |
| Any domain table                                         | no    | Its own context's plugin: `identity`, `content`, `media`, `alarms`, `segments`…       |
| Aggregates, repositories, mappers                        | no    | The `domain/` and `infrastructure/` layers inside the plugins (ADR-0003)              |
| Event kinds and their payloads                           | no    | The event helpers of the six publishing contexts                                      |
| Reactions to events                                      | no    | `activity/server`, `alarms/server` — registered at runtime                            |
| Auditing and the activity log                            | no    | `activity/server`: the subscriber + the `activity_events` table                       |
| The `db:generate` / `db:migrate` targets                 | no    | `@orthacms/nx` (target inference) on top of `@orthacms/cli` (`applyPluginMigrations`) |
| The order in which migrations are applied                | no    | The host's `plugins` array — `apps/server/src/plugins.ts`                             |
| Reading environment variables                            | no    | `apps/server/ortha.config.ts` — the only place that reads `process.env`            |
| Enabling Nest's shutdown hooks                           | no    | `createServer` in `@orthacms/bootstrap-server`                                        |
| Pruning old outbox rows                                  | yes   | `OutboxDispatcher.pruneDelivered` + the hourly `pruneIfDue`; delivered rows only      |
| Metrics, health checks, a queue UI                       | no    | Absent. Only logs and SQL                                                             |

### Its relationship to ADR-0003

The “Tactical DDD inside plugins” ADR lists eight decisions; this package implements the **sixth** in full and is the foundation for the fifth:

- **Decision 5** — “the use case owns the transaction boundary through a shared Unit of Work”. The shared `UnitOfWork` lives here.
- **Decision 6** — “replace in-band audit writes with domain events plus an outbox”. Verbatim: “the `UnitOfWork`, the outbox and the `DomainEvent` contract live once — in `@orthacms/database`”.
- **The dependency rule** — `domain/` imports no Nest, no Drizzle, no React. That is exactly why the event envelope and its builder sit in a file with not a single framework import: an aggregate _is allowed_ to use them.
- **What was left as “follow-up”** — the ADR promises ESLint module-boundary rules inferred by `@orthacms/nx` for layered packages. They do not apply to this package: there are no layers here by definition.

> **How to read “infrastructure without a domain”**
>
> This is neither an omission nor a debt. The package has not a single business rule that could be broken — so there is nothing for an aggregate to model. All of its invariants (section 11) concern _mechanics_: connections, transactions, delivery. A `domain/` folder appearing here would mean the subject area had leaked into the infrastructure, and it should be reverted.

## 14. Discrepancies between the code and the documentation

Every statement in the documentation was checked against the implementation. Below is what did not match.

| Where                                                   | What it says                                                                                                                                                                                     | How it actually is                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCHITECTURE.md, §4 “The data layer”                    | “It owns **no schemas and no migrations**”                                                                                                                                                       | It owns the `outbox_events` table and carries **three** migrations of its own, with a `__drizzle_migrations_database` tracking table. The package's `AGENTS.md`, the root `AGENTS.md` and `drizzle.config.ts` all state that exception honestly — only this paragraph was not updated     |
| CONTEXT-MAP.md, the `database` row                      | “One Drizzle/`pg` connection via DI. **Owns no schema**”                                                                                                                                         | The same discrepancy. On top of that, the phrase “via DI” says nothing about the second, non-DI access route (`getDatabase()`/`getPool()`), which the package exports deliberately                                                                                                        |
| packages/database/AGENTS.md                             | The heading “**Two** things the outbox deliberately bounds”                                                                                                                                      | **Resolved.** It had drifted to three items and has since gained a fourth (retention); the heading now reads “Four”                                                                                                                                                                       |
| packages/database/AGENTS.md, “Key exports”              | Lists the package's exports                                                                                                                                                                      | The list is incomplete: it omits `attachActor` and `EventActor` (even though `attachActor` is mandatory for auditing), `closeDatabase`, `DEFAULT_POOL_MAX`, `DEFAULT_CONNECTION_TIMEOUT_MS` and `MAX_DELIVERY_ATTEMPTS`                                                                   |
| packages/database/AGENTS.md, “Architecture → Lifecycle” | Explains in detail why `releaseDatabase` is used rather than `closeDatabase`, as part of the public behaviour                                                                                    | `releaseDatabase` is **not exported** from `src/index.ts` — it is an internal function available only to the `DatabaseShutdown` provider. Only the unconditional `closeDatabase` is handed outwards. The description is right in substance but reads as a description of an available API |
| packages/database/AGENTS.md, “Configuration”            | The plugin-wiring example is captioned `apps/server/src/main.ts`                                                                                                                                 | **Resolved.** The example is now captioned `apps/server/src/plugins.ts`, which is where the call really is                                                                                                                                                                                |
| docs/adr/0003-tactical-ddd-inside-plugins.md            | Status **Proposed**, noting that it “flips to Accepted once the workspaces pilot (Wave 1) merges”                                                                                                | The foundation (`UnitOfWork` + outbox + `DomainEvent`) is in place, the `workspaces/server` package has been carved out and works in layers, and the audit log has moved to a subscriber. The status was never flipped                                                                    |
| identity/server, `identity-events.ts`                   | The comment speaks of moving the audit log onto an outbox subscriber as something in the future (“Wave 3's move…”), and says that emitting events is “harmless **until that subscriber exists**” | The subscriber exists — `AuditEventSubscriber` in `activity/server` — and it already listens to three of these kinds (`user.password_changed`, `user.activated`, `auth.signed_in`). The “no subscriber” claim remains true only for the other eight kinds                                 |
| ARCHITECTURE.md, §5, step 4                             | Describes the post-commit drain and the 5-second poll                                                                                                                                            | Correct, but it does not mention the two limiters that define behaviour under load: the ceiling of 15 attempts with exponential backoff, and the “one drain per process” rule. A reader of that paragraph will not learn that an event can be parked forever                              |
| The documentation as a whole                            | —                                                                                                                                                                                                | **Resolved.** Both gaps now have code behind them as well as prose: delivered rows are pruned on a configurable window (§04, §10, I-25), and a parked event is retried over HTTP rather than in `psql` (I-26, activity's `POST /api/activity/dead-letters/:id/retry`)                     |

<details>
<summary>Minor points that did not rise to a table row</summary>

`nextAttemptAfter` is exported from `outbox-dispatcher.ts` but not from the package's barrel — it is visible only to a unit test inside the package. That is deliberate, but it means a deployment can neither read nor override the backoff curve.

The empty `catch` in `UnitOfWork.run` logs nothing at all. The comment explains why, and the poll really does pick the events up — but a failure of the post-commit drain specifically is nowhere visible as a fact of its own.

`DatabaseServerPlugin` carries a `databaseConfig` field that nobody in the repository reads: the type exists so that the config is available to a host that wants to look at it.

</details>

---

**The second dossier in the series.** Written for the `packages/database` package in the same skeleton as the Identity dossier: business description → composition → the connection → data → primitives → scenarios → configuration → reliability → invariants → checklist → boundaries → discrepancies. The sections the package does not have (permissions, HTTP API, admin UI) have dropped out — it has not a single route and not a single screen.

The source is the code: `src/lib/utils/db.ts`, `database.module.ts`, `uow/unit-of-work.ts`, `outbox/outbox-writer.ts`, `outbox/outbox-dispatcher.ts`, `events/domain-event.ts`, `schema/outbox-events.ts`, both migrations, the package's unit specs and the three e2e suites in `apps/server-e2e/src/server/database/`; plus the subscribers in `activity/server` and `alarms/server` and all six event catalogues. `AGENTS.md`, `ARCHITECTURE.md` and ADR-0003 were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
