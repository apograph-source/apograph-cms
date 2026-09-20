import { Module, type DynamicModule } from '@nestjs/common';
import { MAIL_DISPATCHER, MAIL_PROVIDER } from '@ortha/mail-domain';
import type { MailProvider } from '@ortha/mail-domain';
import { MAIL_CONFIG } from './mail.tokens';
import { MailDispatcherService } from './application/mail-dispatcher.service';
import { MailDeliveryRepository } from './infrastructure/mail-delivery.repository';
import { MailDeliveryWorker } from './infrastructure/mail-delivery.worker';
import { MailProviderCheck } from './infrastructure/mail-provider.check';
import { resolveMailConfig, type MailPluginConfig } from './types/mail-config';

/** What `MailModule.forRoot` binds into DI. */
export interface MailModuleOptions {
    /** The deployment's one mail backend, built at the composition root. */
    provider: MailProvider;
    /** Host config — the sender, the app URL, the worker's pacing. */
    config: MailPluginConfig;
}

/**
 * The mail plugin's one dynamic module.
 *
 * `global: true` like every other plugin here, and load-bearing rather than
 * habitual: `MAIL_DISPATCHER` is what `users-server` injects `@Optional()` to
 * get its three messages sent, and it can only find it because this module is
 * global and the token is exported.
 *
 * **A deployment that registers no mail plugin binds nothing**, and that
 * absence is the whole switch: the invite and reset routes keep returning the
 * raw token exactly as they do today, no queue exists, and no worker runs
 * (mail:I-01).
 */
@Module({})
export class MailModule {
    static forRoot(options: MailModuleOptions): DynamicModule {
        return {
            module: MailModule,
            global: true,
            providers: [
                {
                    provide: MAIL_CONFIG,
                    useValue: resolveMailConfig(options.config)
                },
                { provide: MAIL_PROVIDER, useValue: options.provider },
                MailDeliveryRepository,
                MailDispatcherService,
                // The port, under the token every consumer injects. Bound to the
                // same instance rather than a second one, so `revealsLinks` and
                // the queue a route reads are the ones the worker drains.
                {
                    provide: MAIL_DISPATCHER,
                    useExisting: MailDispatcherService
                },
                // Arms the sender. The only place this plugin touches the
                // network, and it never holds a transaction while it does.
                MailDeliveryWorker,
                // Refuses the boot on a backend that cannot send.
                MailProviderCheck
            ],
            exports: [
                MAIL_CONFIG,
                MAIL_PROVIDER,
                MAIL_DISPATCHER,
                MailDispatcherService,
                MailDeliveryRepository,
                MailDeliveryWorker
            ]
        };
    }
}
