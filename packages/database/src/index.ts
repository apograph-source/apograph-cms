export type { Database, DatabasePluginConfig } from './lib/types';
export {
    initDatabase,
    closeDatabase,
    getDatabase,
    getPool,
    DEFAULT_POOL_MAX,
    DEFAULT_CONNECTION_TIMEOUT_MS
} from './lib/utils/db';
export { DatabasePlugin } from './lib/utils/database-plugin';
export type { DatabaseServerPlugin } from './lib/utils/database-plugin';
export {
    DatabaseModule,
    DATABASE_TOKEN,
    InjectDatabase,
    OUTBOX_RETENTION_DAYS,
    InjectOutboxRetentionDays
} from './lib/database.module';
export {
    createDomainEvent,
    attachActor,
    EVENT_ACTOR_TYPE,
    DOMAIN_EVENT_SUBSCRIBERS
} from './lib/events/domain-event';
export type {
    DomainEvent,
    CreateDomainEventParams,
    DomainEventSubscriber,
    EventActor,
    EventActorType,
    EventOrigin
} from './lib/events/domain-event';
export { UnitOfWork } from './lib/uow/unit-of-work';
export { OutboxWriter } from './lib/outbox/outbox-writer';
export {
    OutboxDispatcher,
    MAX_DELIVERY_ATTEMPTS,
    DEFAULT_OUTBOX_RETENTION_DAYS
} from './lib/outbox/outbox-dispatcher';
export { outboxEvents } from './lib/schema';
export type {
    DeadLetter,
    RetriedDeadLetter,
    RetryDeadLetterResult
} from './lib/outbox/outbox-dispatcher';
