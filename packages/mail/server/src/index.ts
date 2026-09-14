/**
 * `@apograph/mail-server` — the CMS's outgoing messages.
 *
 * Owns one table (`mail_deliveries`) and ships its migrations, renders the
 * three transactional messages the product sends, and hands them to the one
 * provider the deployment configured — from a worker that holds no transaction
 * while it waits on a mail server.
 *
 * The unusual half is the **enqueue**, and ADR-0018 is why: the raw token
 * exists only inside the transaction that issued it, so the message is rendered
 * and written there rather than rebuilt later by an outbox subscriber. The send
 * still obeys ADR-0016's rule — claim, commit, then open a socket.
 *
 * What a message *says*, and the two ports either side of it, live in
 * `@apograph/mail-domain`.
 */

export {
    MailServerPlugin,
    type MailPluginOptions,
    type MailServerPluginType
} from './lib/utils/mail-plugin';

export { MailModule, type MailModuleOptions } from './lib/mail.module';

export {
    MAIL_DEFAULTS,
    resolveMailConfig,
    type MailPluginConfig,
    type ResolvedMailConfig
} from './lib/types/mail-config';

export { InjectMailConfig, MAIL_CONFIG } from './lib/mail.tokens';

export { MailDispatcherService } from './lib/application/mail-dispatcher.service';

export {
    MailDeliveryRepository,
    type ClaimedMail,
    type MailToQueue,
    type UndeliveredMail
} from './lib/infrastructure/mail-delivery.repository';

export { MailDeliveryWorker } from './lib/infrastructure/mail-delivery.worker';

export { mailDeliveries } from './lib/infrastructure/schema';
