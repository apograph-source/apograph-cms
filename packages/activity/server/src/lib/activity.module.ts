import { DynamicModule, Module } from '@nestjs/common';
import { ACTIVITY_RECORDER } from '@ortha/identity-server';
import { ListActivityController } from './activity/controllers/list-activity.controller';
import { DeadLettersController } from './activity/controllers/dead-letters.controller';
import { RetryDeadLetterController } from './activity/controllers/retry-dead-letter.controller';
import { EntryActivityController } from './activity/controllers/entry-activity.controller';
import { ActivityService } from './activity/services/activity.service';
import { AuditEventSubscriber } from './activity/infrastructure/audit-event.subscriber';
import { ActivityCopilotToolProvider } from './copilot/activity-tool.provider';

/**
 * NestJS module for the activity plugin. Mounts the API under `/api/activity`
 * — three reads plus the dead-letter retry, the one route here that writes
 * anything, and it writes `outbox_events` rather than this plugin's own table
 * — provides {@link ActivityService}, and provides the
 * {@link AuditEventSubscriber} — the **live** audit writer, which self-registers
 * with the outbox dispatcher on bootstrap so every audited domain event becomes
 * an `activity_events` row (Wave 3 moved auditing off in-band recording).
 *
 * **Global**, so any plugin can read/record without re-importing the module. It
 * still binds `ActivityService` to the `ACTIVITY_RECORDER` token — kept for a
 * stable public surface but **deprecated**; nothing writes through it anymore.
 * The Drizzle client comes from `@ortha/database`'s global `DatabaseModule`
 * (which also provides the `OutboxDispatcher`); authorization from identity's
 * `PermissionsGuard`.
 */
@Module({})
export class ActivityModule {
    /** Creates the dynamic module: the read controller, the recorder, the subscriber. */
    static forRoot(): DynamicModule {
        return {
            module: ActivityModule,
            global: true,
            controllers: [
                // The scoped route is declared **before** the global one:
                // `activity/entries/:id` and `activity` are different paths, but
                // keeping the literal-prefixed controller first is the same
                // ordering habit the content routes follow, and it stays true
                // as the pattern set grows.
                EntryActivityController,
                ListActivityController,
                DeadLettersController,
                // The plugin's one writing route. Declared after the list it
                // belongs to, and separate from it because the two carry
                // different permissions: reading that something is stuck is
                // `activity:read`, re-running it is `activity:manage`.
                RetryDeadLetterController
            ],
            providers: [
                ActivityService,
                AuditEventSubscriber,
                { provide: ACTIVITY_RECORDER, useExisting: ActivityService },
                // The copilot's audit-log read. Both no-op when no copilot
                // plugin is registered — the registrar injects the registry
                // optionally.
                ActivityCopilotToolProvider
            ],
            exports: [ActivityService, ACTIVITY_RECORDER]
        };
    }
}
