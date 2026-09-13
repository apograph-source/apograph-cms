import { DynamicModule, Module } from '@nestjs/common';
import { ACTIVITY_RECORDER } from '@apograph/identity-server';
import { ListActivityController } from './activity/controllers/list-activity.controller';
import { DeadLettersController } from './activity/controllers/dead-letters.controller';
import { EntryActivityController } from './activity/controllers/entry-activity.controller';
import { ActivityService } from './activity/services/activity.service';
import { AuditEventSubscriber } from './activity/infrastructure/audit-event.subscriber';
import { ActivityCopilotToolProvider } from './copilot/activity-tool.provider';

/**
 * NestJS module for the activity plugin. Mounts the read API under
 * `/api/activity`, provides {@link ActivityService}, and provides the
 * {@link AuditEventSubscriber} — the **live** audit writer, which self-registers
 * with the outbox dispatcher on bootstrap so every audited domain event becomes
 * an `activity_events` row (Wave 3 moved auditing off in-band recording).
 *
 * **Global**, so any plugin can read/record without re-importing the module. It
 * still binds `ActivityService` to the `ACTIVITY_RECORDER` token — kept for a
 * stable public surface but **deprecated**; nothing writes through it anymore.
 * The Drizzle client comes from `@apograph/database`'s global `DatabaseModule`
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
                DeadLettersController
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
