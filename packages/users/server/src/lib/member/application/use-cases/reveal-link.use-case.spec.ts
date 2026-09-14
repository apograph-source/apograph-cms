import type { DomainEvent, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { MailDispatcher, RevealableLink } from '@apograph/mail-domain';
import type { PublicUser } from '@apograph/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import {
    MailNotConfiguredError,
    MemberNotFoundError,
    NoRevealableLinkError
} from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import { RevealLinkUseCase } from './reveal-link.use-case';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const ACTOR: PublicUser = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'admin@example.com',
    name: 'Admin',
    roleId: '33333333-3333-4333-8333-333333333333',
    status: 'active'
};

const OUTSTANDING: RevealableLink = {
    kind: 'invite',
    link: 'https://cms.example.com/identity/accept-invite?token=s3cret',
    queuedAt: new Date('2026-09-14T07:00:00.000Z'),
    attempts: 3,
    lastError: 'ECONNECTION: connect ETIMEDOUT'
};

/**
 * `RevealLinkUseCase` — the audited exception to "no route returns a token".
 *
 * What the tests below pin is not the happy path so much as the three refusals
 * around it: a deployment with no mailer is not withholding anything, a
 * delivered message has nothing left to reveal, and every reveal that *does*
 * happen leaves a row naming who looked.
 */
describe('RevealLinkUseCase', () => {
    function harness(
        member: Member | null,
        outstanding: RevealableLink | null = OUTSTANDING,
        withMail = true
    ) {
        const appended: DomainEvent[] = [];
        const trace: string[] = [];

        const members: MemberRepository = {
            findById: async () => {
                trace.push('findById');
                return member;
            },
            findByIdForAdminGuard: async () => member,
            countActiveAdmins: async () => 5,
            existsByEmail: async () => false,
            save: async () => undefined,
            delete: async () => undefined
        };

        const uow = {
            run: async <T>(fn: () => Promise<T>): Promise<T> => {
                trace.push('uow:enter');
                try {
                    return await fn();
                } finally {
                    trace.push('uow:exit');
                }
            },
            current: () => ({}) as never
        } as unknown as UnitOfWork;

        const outbox = {
            append: async (events: DomainEvent[]) => {
                trace.push('outbox:append');
                appended.push(...events);
            }
        } as unknown as OutboxWriter;

        const mail: MailDispatcher | undefined = withMail
            ? {
                  revealsLinks: false,
                  enqueue: async () => undefined,
                  revealableLink: async () => {
                      trace.push('mail:revealableLink');
                      return outstanding;
                  }
              }
            : undefined;

        return {
            useCase: new RevealLinkUseCase(uow, outbox, members, mail),
            appended,
            trace
        };
    }

    const member = () =>
        Member.rehydrate({
            id: MEMBER_ID,
            email: 'ada@example.com',
            name: 'Ada',
            roleKey: 'contributor',
            status: 'pending'
        });

    it('hands back the outstanding link', async () => {
        const test = harness(member());

        await expect(test.useCase.execute(ACTOR, MEMBER_ID)).resolves.toEqual({
            kind: 'invite',
            link: OUTSTANDING.link,
            queuedAt: OUTSTANDING.queuedAt,
            attempts: 3,
            lastError: 'ECONNECTION: connect ETIMEDOUT'
        });
    });

    it('records who looked, in the same transaction as the read', async () => {
        const test = harness(member());

        await test.useCase.execute(ACTOR, MEMBER_ID);

        // covers: mail:I-02 — every reveal is audited, which is what makes this
        // the exception rather than a second way to get a secret.
        expect(test.appended.map((event) => event.kind)).toEqual([
            MEMBER_EVENT_KINDS.INVITE_LINK_REVEALED
        ]);
        expect(test.appended[0].payload).toMatchObject({
            email: 'ada@example.com',
            mailKind: 'invite',
            actor: { id: ACTOR.id, email: ACTOR.email }
        });
        // Never the link itself: the audit table is stamped and never pruned.
        expect(JSON.stringify(test.appended[0].payload)).not.toContain(
            's3cret'
        );
        expect(test.trace).toEqual([
            'uow:enter',
            'findById',
            'mail:revealableLink',
            'outbox:append',
            'uow:exit'
        ]);
    });

    it('refuses when the deployment sends no mail', async () => {
        const test = harness(member(), OUTSTANDING, false);

        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).rejects.toBeInstanceOf(MailNotConfiguredError);
        // Nothing was withheld, so nothing is revealed — and nothing is
        // audited either.
        expect(test.appended).toHaveLength(0);
    });

    it('refuses when the message was delivered and its row deleted', async () => {
        const test = harness(member(), null);

        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).rejects.toBeInstanceOf(NoRevealableLinkError);
        expect(test.appended).toHaveLength(0);
    });

    it('404s an unknown member before it asks the mailer anything', async () => {
        const test = harness(null);

        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).rejects.toBeInstanceOf(MemberNotFoundError);
        expect(test.trace).not.toContain('mail:revealableLink');
    });
});
