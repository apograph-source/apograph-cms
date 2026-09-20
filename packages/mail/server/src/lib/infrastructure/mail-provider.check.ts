import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { MAIL_PROVIDER, type MailProvider } from '@ortha/mail-domain';
import { InjectMailConfig } from '../mail.tokens';
import type { ResolvedMailConfig } from '../types/mail-config';

/**
 * Refuses to boot on a mail backend this process cannot use.
 *
 * The failure this prevents is quiet and expensive: with a provider configured
 * the invite route stops returning the link, so a bad credential does not
 * produce an error anybody sees — it produces invitations that appear to be
 * sent and are received by nobody. The same reasoning as media's
 * `StorageProviderCheck`, which refuses a library whose bytes are in a backend
 * this process is not connected to.
 *
 * A provider that declares `capabilities.verifiable: false` has nothing to
 * reach — the console adapter — and is not asked.
 */
@Injectable()
export class MailProviderCheck implements OnApplicationBootstrap {
    private readonly logger = new Logger(MailProviderCheck.name);

    constructor(
        @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
        @InjectMailConfig() private readonly config: ResolvedMailConfig
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if (!this.provider.capabilities.verifiable || !this.provider.verify) {
            this.logger.log(
                `Mail is enabled through the "${this.provider.id}" provider, which declares no boot check.`
            );
            return;
        }

        try {
            await this.provider.verify();
        } catch (error) {
            const reason =
                error instanceof Error ? error.message : String(error);
            // Names the sender as well as the backend: the two configuration
            // mistakes that land here are a credential the relay rejects and a
            // `from` it will not send on behalf of, and the message should not
            // make the operator guess which.
            throw new Error(
                `The mail provider "${this.provider.id}" refused the configured sender ` +
                    `${JSON.stringify(this.config.from)}: ${reason}`,
                { cause: error }
            );
        }

        this.logger.log(
            `Mail is enabled through the "${this.provider.id}" provider, sending as ${this.config.from}.`
        );
    }
}
