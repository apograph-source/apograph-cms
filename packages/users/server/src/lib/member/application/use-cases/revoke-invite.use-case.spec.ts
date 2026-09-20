import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import {
    InvalidMemberStateError,
    MemberNotFoundError
} from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import { RevokeInviteUseCase } from './revoke-invite.use-case';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

/** The signed-in admin revoking the invite. */
const ACTOR: PublicUser = {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'admin@example.com',
    name: 'Admin',
    roleId: '33333333-3333-4333-8333-333333333333',
    status: 'active'
};

/**
 * `RevokeInviteUseCase` — the guard that stands between this route and a
 * `DELETE` of a real account's row.
 *
 * This is the only endpoint in the package that deletes from `users`, and the
 * delete cascades: tokens and memberships go with it. `revokeInvite()` accepts
 * only a `pending` placeholder, and the whole safety of the route is that the
 * guard is consulted *before* `members.delete` — a version that deleted first
 * and validated after would still answer 409 to an active member, having
 * already removed them.
 */
describe('RevokeInviteUseCase', () => {
    /** The use case wired to recording doubles, sharing one ordered trace. */
    function harness(member: Member | null) {
        const trace: string[] = [];
        const appended: DomainEvent[] = [];
        const deleted: Member[] = [];

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
            delete: async (aggregate) => {
                trace.push('delete');
                deleted.push(aggregate);
            }
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

        return {
            useCase: new RevokeInviteUseCase(uow, outbox, members),
            trace,
            appended,
            deleted
        };
    }

    /** A member in the given lifecycle state (pending by default). */
    function member(status = 'pending'): Member {
        return Member.rehydrate({
            id: MEMBER_ID,
            email: 'ada@example.com',
            name: 'Ada',
            roleKey: 'contributor',
            status
        });
    }

    it('deletes a pending placeholder and records the removal', async () => {
        const test = harness(member());

        await test.useCase.execute(ACTOR, MEMBER_ID);

        expect(test.deleted).toHaveLength(1);
        expect(test.appended.map((event) => event.kind)).toEqual([
            MEMBER_EVENT_KINDS.REMOVED
        ]);
        // The email snapshot rides on the event because the row it came from is
        // gone by the time the audit subscriber runs.
        expect(test.appended[0].payload).toMatchObject({
            email: 'ada@example.com',
            actor: { id: ACTOR.id, email: ACTOR.email }
        });
    });

    it.each(['active', 'disabled'])(
        'never passes a %s member to delete',
        async (status) => {
            const test = harness(member(status));

            await expect(
                test.useCase.execute(ACTOR, MEMBER_ID)
            ).rejects.toBeInstanceOf(InvalidMemberStateError);

            // Real accounts are disabled, never deleted — and the guard has to
            // win before the cascade runs, not after.
            expect(test.trace).not.toContain('delete');
            expect(test.deleted).toHaveLength(0);
            expect(test.appended).toHaveLength(0);
        }
    );

    it('never deletes for an unknown member', async () => {
        const test = harness(null);

        await expect(
            test.useCase.execute(ACTOR, MEMBER_ID)
        ).rejects.toBeInstanceOf(MemberNotFoundError);
        expect(test.trace).not.toContain('delete');
    });

    it('appends inside the unit of work, after the delete', async () => {
        const test = harness(member());

        await test.useCase.execute(ACTOR, MEMBER_ID);

        expect(test.trace).toEqual([
            'uow:enter',
            'findById',
            'delete',
            'outbox:append',
            'uow:exit'
        ]);
    });
});
