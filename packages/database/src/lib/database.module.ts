import {
    DynamicModule,
    Injectable,
    Logger,
    Module,
    type OnApplicationShutdown
} from '@nestjs/common';
import { getDatabase, releaseDatabase } from './utils/db';
import { DATABASE_TOKEN, OUTBOX_RETENTION_DAYS } from './database.tokens';
import type { DatabasePluginConfig } from './types';
import { DOMAIN_EVENT_SUBSCRIBERS } from './events/domain-event';
import { UnitOfWork } from './uow/unit-of-work';
import { OutboxWriter } from './outbox/outbox-writer';
import {
    DEFAULT_OUTBOX_RETENTION_DAYS,
    OutboxDispatcher
} from './outbox/outbox-dispatcher';

// Re-exported so the historical `@apograph/database` barrel specifier
// (`export { ..., DATABASE_TOKEN, InjectDatabase } from './lib/database.module'`)
// stays valid; the definitions live in the dependency-free tokens module to
// avoid an initialization cycle with the primitives below.
export {
    DATABASE_TOKEN,
    InjectDatabase,
    OUTBOX_RETENTION_DAYS,
    InjectOutboxRetentionDays
} from './database.tokens';

/**
 * Gives up this application's claim on the pool when it shuts down.
 *
 * **A provider, not a hook on {@link DatabaseModule} itself**, and that is not
 * a style choice. `DatabaseModule` carries a bare `@Module({})` as well as its
 * `forRoot()` dynamic form, so a plugin that writes `imports: [DatabaseModule]`
 * — `copilot/server` does, deliberately, to document the dependency — gives the
 * container a **second** host for the same class. A lifecycle hook on the class
 * then fires once per host, and released the pool twice for one shutdown. A
 * provider lives only in the dynamic module, so there is exactly one per app.
 */
@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
    private readonly logger = new Logger(DatabaseShutdown.name);

    /**
     * Drains the pool on shutdown.
     *
     * `createServer` enables Nest's shutdown hooks; this is the plugin's half
     * of that, which was missing — nothing ended the pool. Invisible in the
     * shipped server (it exits immediately and Postgres reaps the backends) and
     * a real leak for a host that **embeds** `createServer` and keeps running,
     * which is why `createServer` hands the application back at all.
     *
     * `releaseDatabase`, not `getPool().end()` and not `closeDatabase()`. Not
     * `end()` because ending the pool without clearing the memo leaves
     * `initDatabase` returning early with an ended pool, and every query after
     * it throws "Cannot use a pool after calling end on the pool". Not
     * `closeDatabase()` because the pool is a **process singleton**: a second
     * application in the same process shares the first's, so an unconditional
     * close here ends the database underneath an app that is still answering.
     *
     * `onApplicationShutdown` rather than `onModuleDestroy`, and the ordering
     * is load-bearing: Nest runs every `onModuleDestroy` first, so
     * {@link OutboxDispatcher} gets to finish its in-flight drain before the
     * connections underneath it are taken away.
     */
    async onApplicationShutdown(): Promise<void> {
        try {
            await releaseDatabase();
        } catch (error) {
            // Never throw out of a shutdown hook — the rest of the teardown
            // still has to run, and the process is going away regardless.
            this.logger.error(
                'Failed to close the database pool on shutdown',
                error instanceof Error ? error.stack : String(error)
            );
        }
    }
}

/**
 * NestJS module that provides the Drizzle instance to the DI container,
 * plus the shared tactical-DDD primitives — {@link UnitOfWork},
 * {@link OutboxWriter}, {@link OutboxDispatcher}. Registered globally so any
 * plugin module can inject them without importing this module. Must be
 * created after {@link initDatabase}.
 */
@Module({})
export class DatabaseModule {
    /**
     * Creates a global dynamic module providing the database + primitives.
     *
     * The argument is optional and deliberately narrow: the connection settings
     * are consumed by `initDatabase` before Nest exists, so the only thing the
     * container needs from the plugin's config is the outbox retention window.
     */
    static forRoot(
        config: Pick<DatabasePluginConfig, 'outboxRetentionDays'> = {}
    ): DynamicModule {
        return {
            module: DatabaseModule,
            global: true,
            providers: [
                {
                    provide: DATABASE_TOKEN,
                    useFactory: () => getDatabase()
                },
                {
                    provide: OUTBOX_RETENTION_DAYS,
                    useValue:
                        config.outboxRetentionDays ??
                        DEFAULT_OUTBOX_RETENTION_DAYS
                },
                // Default to an empty array so injection never fails before a
                // plugin contributes subscribers. Downstream plugins register
                // at runtime via `OutboxDispatcher.register(...)`.
                {
                    provide: DOMAIN_EVENT_SUBSCRIBERS,
                    useValue: []
                },
                DatabaseShutdown,
                UnitOfWork,
                OutboxWriter,
                OutboxDispatcher
            ],
            exports: [
                DATABASE_TOKEN,
                OUTBOX_RETENTION_DAYS,
                UnitOfWork,
                OutboxWriter,
                OutboxDispatcher
            ]
        };
    }
}
