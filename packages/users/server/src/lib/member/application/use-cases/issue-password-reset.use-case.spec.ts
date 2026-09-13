import type { DomainEvent, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import {
    InvalidMemberStateError,
    MemberNotFoundError
} from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import type { PasswordResetTokenService } from '../../infrastructure/persistence/password-reset-token.service';
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
    /** The use case wired to recording doubles, sharing one ordered trace. */
    function harness(member: Member | null) {
        const trace: string[] = [];
        const appended: DomainEvent[] = [];
        const rotations: { userId: string; options: unknown }[] = [];

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
                return 'raw-reset-token';
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

        return {
            useCase: new IssuePasswordResetUseCase(
                uow,
                outbox,
                resetTokens,
                members
            ),
            trace,
            appended,
            rotations
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
