import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import {
    InvalidMemberStateError,
    MemberNotFoundError
} from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import type { PasswordResetTokenService } from '../../infrastructure/persistence/password-reset-token.service';
import type { MailDispatcher, TransactionalMail } from '@orthacms/mail-domain';
import { PASSWORD_RESET_COOLDOWN_SECONDS } from '../../member.constants';
import { IssuePasswordResetUseCase } from './issue-password-reset.use-case';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

/** The signed-in admin issuing the link. */
const ACTOR: PublicUser = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'admin@example.com',
    name: 'Admin',
    roleId: '33333333-3333-4333-8333-333333333333',
    status: 'active'
};

/**
 * `IssuePasswordResetUseCase` — the ordering of its lifecycle guard against the
 * side effect it protects.
 *
 * `ensureCanResetPassword` has to run **before** `rotate`, because rotating is
 * destructive: it deletes whatever reset token the member holds. Called on a
 * `pending` or `disabled` member it would kill a live link on the way to
 * answering 409 — a refusal that still damages state. The aggregate's own spec
 * proves the guard rejects those two states; only this one proves the guard is
 * consulted before anything is destroyed.
 */
describe('IssuePasswordResetUseCase', () => {
    /** The expiry the token double reports, and the mail row must carry. */
    const EXPIRES_AT = new Date('2026-09-20T08:30:00.000Z');

    /**
     * The use case wired to recording doubles, sharing one ordered trace.
     *
     * `mail` is the optional dispatcher: passing none is a deployment that
     * configured no provider, which is the behaviour the product shipped with
     * and still has to keep.
     */
    function harness(
        member: Member | null,
        mailOptions?: { revealsLinks?: boolean }
    ) {
        const trace: string[] = [];
        const appended: DomainEvent[] = [];
        const rotations: { userId: string; options: unknown }[] = [];
        const queued: TransactionalMail[] = [];

        const members: MemberRepository = {
            findById: async () => {
                trace.push('findById');
                return member;
            },
            findByIdForAdminGuard: async () => {
                trace.push('findByIdForAdminGuard');
                return member;
            },
            countActiveAdmins: async () => 5,
            existsByEmail: async () => false,
            save: async () => {
                trace.push('save');
            },
            delete: async () => {
                trace.push('delete');
            }
        };

        const resetTokens = {
            rotate: async (
                userId: string,
                _executor: unknown,
                options: unknown
            ) => {
                trace.push('resetTokens:rotate');
                rotations.push({ userId, options });
                return { raw: 'raw-reset-token', expiresAt: EXPIRES_AT };
            }
        } as unknown as PasswordResetTokenService;

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

        const mail: MailDispatcher | undefined = mailOptions
            ? {
                  revealsLinks: mailOptions.revealsLinks ?? false,
                  enqueue: async (item) => {
                      trace.push('mail:enqueue');
                      queued.push(item);
                  },
                  revealableLink: async () => null
              }
            : undefined;

        return {
            useCase: new IssuePasswordResetUseCase(
                uow,
                outbox,
                resetTokens,
                members,
                mail
            ),
            trace,
            appended,
            rotations,
            queued
        };
    }

    /** A member in the given lifecycle state (active by default). */
    function member(status = 'active'): Member {
        return Member.rehydrate({
            id: MEMBER_ID,
            email: 'ada@example.com',
            name: 'Ada',
            roleKey: 'contributor',
            status
        });
    }

    it('returns the raw token for an active member [users:I-08]', async () => {
        const test = harness(member());

        await expect(test.useCase.execute(ACTOR, MEMBER_ID)).resolves.toBe(
            'raw-reset-token'
        );
        expect(test.rotations).toEqual([
            {
                userId: MEMBER_ID,
                options: { minIntervalSeconds: PASSWORD_RESET_COOLDOWN_SECONDS }
            }
        ]);
    });

    it('queues the message in-band and withholds the token once a mailer exists', async () => {
        const test = harness(member(), {});

        // covers: mail:I-02 — with a provider configured no route hands back a
        // raw token; the message carries it and `reveal-link` is the exception.
        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).resolves.toBeNull();

        expect(test.queued).toEqual([
            {
                kind: 'password_reset',
                to: 'ada@example.com',
                userId: MEMBER_ID,
                recipientName: 'Ada',
                actorName: 'Admin',
                token: 'raw-reset-token',
                expiresAt: EXPIRES_AT
            }
        ]);
        // covers: mail:I-03 — queued inside the same unit of work as the
        // rotation, because that is the only place the plaintext exists.
        expect(test.trace).toEqual([
            'uow:enter',
            'findById',
            'resetTokens:rotate',
            'mail:enqueue',
            'outbox:append',
            'uow:exit'
        ]);
    });

    it('returns the token alongside the message in link-revealing mode', async () => {
        const test = harness(member(), { revealsLinks: true });

        await expect(test.useCase.execute(ACTOR, MEMBER_ID)).resolves.toBe(
            'raw-reset-token'
        );
        expect(test.queued).toHaveLength(1);
    });

    it.each(['pending', 'disabled'])(
        'never rotates a %s member’s token',
        async (status) => {
            const test = harness(member(status));

            await expect(
                test.useCase.execute(ACTOR, MEMBER_ID)
            ).rejects.toBeInstanceOf(InvalidMemberStateError);

            // Not merely "it 409s": nothing was destroyed on the way out, and
            // no audit row claims a link was handed over.
            expect(test.trace).not.toContain('resetTokens:rotate');
            expect(test.trace).not.toContain('outbox:append');
            expect(test.appended).toHaveLength(0);
        }
    );

    it('never rotates for an unknown member', async () => {
        const test = harness(null);

        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).rejects.toBeInstanceOf(MemberNotFoundError);
        expect(test.trace).not.toContain('resetTokens:rotate');
    });

    it('records the issue as an attributed fact, inside the transaction', async () => {
        const test = harness(member());

        await test.useCase.execute(ACTOR, MEMBER_ID);

        // Handing someone a link that can take over an account is an
        // administrative act in its own right, attributed at mint time whether
        // or not the link is ever redeemed.
        expect(test.appended.map((event) => event.kind)).toEqual([
            MEMBER_EVENT_KINDS.PASSWORD_RESET_ISSUED
        ]);
        expect(test.appended[0].payload).toMatchObject({
            email: 'ada@example.com',
            actor: { id: ACTOR.id, email: ACTOR.email }
        });
        expect(test.trace).toEqual([
            'uow:enter',
            'findById',
            'resetTokens:rotate',
            'outbox:append',
            'uow:exit'
        ]);
    });
});
