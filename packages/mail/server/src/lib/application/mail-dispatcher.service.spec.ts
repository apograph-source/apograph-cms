import { MAIL_KINDS } from '@apograph/mail-domain';
import { MailDispatcherService } from './mail-dispatcher.service';
import type {
    MailDeliveryRepository,
    MailToQueue
} from '../infrastructure/mail-delivery.repository';
import { resolveMailConfig } from '../types/mail-config';

const expiresAt = new Date('2026-09-20T08:30:00.000Z');

function dispatcherFor(
    overrides: Parameters<typeof resolveMailConfig>[0] = {
        appUrl: 'https://cms.example.com',
        from: 'no-reply@example.com'
    }
) {
    const queued: MailToQueue[] = [];
    const repository = {
        enqueue: jest.fn(async (mail: MailToQueue) => {
            queued.push(mail);
        }),
        newestUndeliveredFor: jest.fn(async () => null)
    };
    return {
        queued,
        repository,
        dispatcher: new MailDispatcherService(
            repository as unknown as MailDeliveryRepository,
            resolveMailConfig(overrides)
        )
    };
}

describe('queueing a transactional message', () => {
    it('renders the invite and points it at the configured app URL', async () => {
        const { dispatcher, queued } = dispatcherFor();

        await dispatcher.enqueue({
            kind: MAIL_KINDS.INVITE,
            to: 'ada@example.com',
            userId: 'user-1',
            recipientName: 'Ada',
            actorName: 'Grace',
            token: 's3cret',
            expiresAt
        });

        // covers: mail:I-11 — the link comes from `appUrl`, never from a header.
        expect(queued[0]).toMatchObject({
            kind: 'invite',
            toAddress: 'ada@example.com',
            userId: 'user-1',
            link: 'https://cms.example.com/identity/accept-invite?token=s3cret',
            expiresAt
        });
        expect(queued[0].subject).toContain('invited');
        expect(queued[0].bodyText).toContain('token=s3cret');
        expect(queued[0].bodyHtml).toContain('token=s3cret');
    });

    it('points a password reset at the reset route instead', async () => {
        const { dispatcher, queued } = dispatcherFor();

        await dispatcher.enqueue({
            kind: MAIL_KINDS.PASSWORD_RESET,
            to: 'ada@example.com',
            userId: 'user-1',
            token: 's3cret',
            expiresAt
        });

        expect(queued[0].link).toBe(
            'https://cms.example.com/identity/reset-password?token=s3cret'
        );
    });

    it('uses a host’s template when it overrode one', async () => {
        const { dispatcher, queued } = dispatcherFor({
            appUrl: 'https://cms.example.com',
            from: 'no-reply@example.com',
            productName: 'Redaktion',
            templates: {
                invite: (context) => ({
                    subject: `Einladung zu ${context.productName}`,
                    text: context.link
                })
            }
        });

        await dispatcher.enqueue({
            kind: MAIL_KINDS.INVITE,
            to: 'ada@example.com',
            userId: 'user-1',
            token: 's3cret',
            expiresAt
        });

        expect(queued[0].subject).toBe('Einladung zu Redaktion');
        // The template produced no HTML part, so none is stored — rather than
        // an empty string a provider would send as an empty body.
        expect(queued[0].bodyHtml).toBeUndefined();
    });

    it('reports whether the deployment is in link-revealing mode', () => {
        expect(dispatcherFor().dispatcher.revealsLinks).toBe(false);
        expect(
            dispatcherFor({
                appUrl: 'https://cms.example.com',
                from: 'no-reply@example.com',
                revealLinks: true
            }).dispatcher.revealsLinks
        ).toBe(true);
    });
});

describe('revealing the link of a message that never left', () => {
    it('hands back the newest undelivered one', async () => {
        const { dispatcher, repository } = dispatcherFor();
        const createdAt = new Date('2026-09-14T07:00:00.000Z');
        repository.newestUndeliveredFor.mockResolvedValue({
            kind: 'invite',
            link: 'https://cms.example.com/identity/accept-invite?token=s3cret',
            createdAt,
            attempts: 3,
            lastError: 'connection refused'
        } as never);

        await expect(dispatcher.revealableLink('user-1')).resolves.toEqual({
            kind: 'invite',
            link: 'https://cms.example.com/identity/accept-invite?token=s3cret',
            queuedAt: createdAt,
            attempts: 3,
            lastError: 'connection refused'
        });
    });

    it('has nothing to reveal once the message went out', async () => {
        const { dispatcher } = dispatcherFor();
        // A delivered row is deleted, so there is no link left to hand back —
        // which is what makes this an answer to "it never arrived" rather than
        // a second copy of a message that did.
        await expect(dispatcher.revealableLink('user-1')).resolves.toBeNull();
    });
});
