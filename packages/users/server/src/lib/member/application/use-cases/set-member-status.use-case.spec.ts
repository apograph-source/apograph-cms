import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import { SelfActionError } from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import type { SessionRevoker } from '../ports/session-revoker.port';
import { SetMemberStatusUseCase } from './set-member-status.use-case';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '99999999-9999-4999-8999-999999999999';

/** The signed-in admin flipping someone's status. */
const ACTOR: PublicUser = {
    id: ACTOR_ID,
    email: 'admin@example.com',
    name: 'Admin',
    roleId: '33333333-3333-4333-8333-333333333333',
    status: 'active'
};

/**
 * `SetMemberStatusUseCase` — the orchestration a suspended account depends on:
 * the guard that runs before any transaction opens, the lock the disable path
 * loads under, and the session revocation that must commit with the status
 * flag or not at all.
 *
 * The revocation is the immediate half of the lockout. If it committed
 * separately — or ran before the save and survived a rollback — a suspended
 * member would keep the session they are sitting in until it expired, and the
 * endpoint would still answer 200.
 */
describe('SetMemberStatusUseCase', () => {
    /** The use case wired to recording doubles, sharing one ordered trace. */
    function harness(
        member: Member | null,
        options: { activeAdmins?: number; revokeFails?: Error } = {}
    ) {
        const trace: string[] = [];
        const saved: Member[] = [];
        const appended: DomainEvent[] = [];
        const revoked: string[] = [];

        const members: MemberRepository = {
            findById: async () => {
                trace.push('findById');
                return member;
            },
            findByIdForAdminGuard: async () => {
                trace.push('findByIdForAdminGuard');
                return member;
            },
            countActiveAdmins: async () => {
                trace.push('countActiveAdmins');
                return options.activeAdmins ?? 5;
            },
            existsByEmail: async () => false,
            save: async (aggregate) => {
                trace.push('save');
                saved.push(aggregate);
            },
            delete: async () => {
                trace.push('delete');
            }
        };

        const sessions: SessionRevoker = {
            revoke: async (userId) => {
                trace.push('sessions:revoke');
                if (options.revokeFails) {
                    throw options.revokeFails;
                }
                revoked.push(userId);
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
            useCase: new SetMemberStatusUseCase(uow, outbox, members, sessions),
            trace,
            saved,
            appended,
            revoked
        };
    }

    /** A member in the given lifecycle state (an active contributor by default). */
    function member(
        overrides: { id?: string; status?: string; roleKey?: string } = {}
    ): Member {
        return Member.rehydrate({
            id: overrides.id ?? MEMBER_ID,
            email: 'ada@example.com',
            name: 'Ada',
            roleKey: overrides.roleKey ?? 'contributor',
            status: overrides.status ?? 'active'
        });
    }

    describe('disable', () => {
        it('refuses a self-disable before opening a transaction', async () => {
            const test = harness(member({ id: ACTOR_ID }));

            await expect(
                test.useCase.disable(ACTOR, ACTOR_ID)
            ).rejects.toBeInstanceOf(SelfActionError);

            // The check precedes `uow.run` on purpose: a refusal that is
            // certain from the arguments alone should cost neither a
            // transaction nor the global active-admin lock the disable path
            // would otherwise take on the way in.
            expect(test.trace).toEqual([]);
        });

        it('loads under the admin lock and reads the count after it [users:I-01]', async () => {
            const test = harness(member());

            await test.useCase.disable(ACTOR, MEMBER_ID);

            // Order, not just presence: the count is only trustworthy when it
            // is read *under* the lock the guarded load took.
            expect(test.trace.slice(0, 3)).toEqual([
                'uow:enter',
                'findByIdForAdminGuard',
                'countActiveAdmins'
            ]);
        });

        it('revokes the member’s sessions inside the transaction, after the save [users:I-03]', async () => {
            const test = harness(member());

            await test.useCase.disable(ACTOR, MEMBER_ID);

            expect(test.trace).toEqual([
                'uow:enter',
                'findByIdForAdminGuard',
                'countActiveAdmins',
                'save',
                'sessions:revoke',
                'outbox:append',
                'uow:exit'
            ]);
            expect(test.revoked).toEqual([MEMBER_ID]);
        });

        it('propagates a failing revoke out of the unit of work [users:I-03]', async () => {
            const boom = new Error('sessions table unavailable');
            const test = harness(member(), { revokeFails: boom });

            await expect(test.useCase.disable(ACTOR, MEMBER_ID)).rejects.toBe(
                boom
            );

            // The status flag and the revocation are one transaction or
            // neither. Swallowing this would leave a "disabled" member holding
            // a live session — the failure the in-transaction revoke exists to
            // prevent.
            expect(test.trace).toContain('uow:exit');
            expect(test.appended).toHaveLength(0);
        });

        it('drains the aggregate’s own member.disabled fact [users:I-14]', async () => {
            const test = harness(member());

            await test.useCase.disable(ACTOR, MEMBER_ID);

            expect(test.appended.map((event) => event.kind)).toEqual([
                MEMBER_EVENT_KINDS.DISABLED
            ]);
            expect(test.appended[0].payload).toMatchObject({
                actor: { id: ACTOR.id, email: ACTOR.email }
            });
        });
    });

    describe('enable', () => {
        it('mints member.reactivated from the application, the aggregate staying silent', async () => {
            const disabled = member({ status: 'disabled' });
            const test = harness(disabled);

            await test.useCase.enable(ACTOR, MEMBER_ID);

            expect(test.appended.map((event) => event.kind)).toEqual([
                MEMBER_EVENT_KINDS.REACTIVATED
            ]);
            // Enable is not a primary aggregate transition — `Member.enable`
            // raises nothing, so the fact the audit subscriber needs exists
            // only because the use case mints it.
            expect(disabled.pullEvents()).toHaveLength(0);
            expect(test.appended[0].payload).toMatchObject({
                actor: { id: ACTOR.id, email: ACTOR.email }
            });
        });

        it('loads unlocked — reactivating only ever raises the admin count', async () => {
            const test = harness(member({ status: 'disabled' }));

            await test.useCase.enable(ACTOR, MEMBER_ID);

            expect(test.trace).toContain('findById');
            expect(test.trace).not.toContain('findByIdForAdminGuard');
        });

        it('revokes no sessions — the member is being let back in', async () => {
            const test = harness(member({ status: 'disabled' }));

            await test.useCase.enable(ACTOR, MEMBER_ID);

            expect(test.revoked).toEqual([]);
        });
    });
});
