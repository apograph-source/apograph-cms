import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Member } from '../../domain/member';
import type { MemberRepository } from '../../domain/member.repository';
import { SelfActionError } from '../../domain/errors';
import { MEMBER_EVENT_KINDS } from '../../domain/events/member-events';
import type { UpdateMemberDto } from '../dto/update-member.dto';
import { UpdateMemberUseCase } from './update-member.use-case';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '99999999-9999-4999-8999-999999999999';

/** The signed-in admin performing the patch. */
const ACTOR: PublicUser = {
    id: ACTOR_ID,
    email: 'admin@example.com',
    name: 'Admin',
    roleId: '33333333-3333-4333-8333-333333333333',
    status: 'active'
};

/**
 * `UpdateMemberUseCase` — the branch that decides whether a member edit takes
 * the deployment-wide admin lock, and the two events a patch can mint.
 *
 * The loader choice is the load-bearing part and it is invisible from the
 * outside: both loaders return the same aggregate, so a rename routed through
 * `findByIdForAdminGuard` still answers 200 with the right body — it just
 * queues behind a single global `pg_advisory_xact_lock` first, putting every
 * member edit in the deployment in one line. Only the repository can see which
 * one was called.
 */
describe('UpdateMemberUseCase', () => {
    /** The use case wired to recording doubles, sharing one ordered trace. */
    function harness(
        member: Member | null,
        options: { activeAdmins?: number; revoke?: () => void } = {}
    ) {
        const trace: string[] = [];
        const saved: Member[] = [];
        const appended: DomainEvent[] = [];

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
            useCase: new UpdateMemberUseCase(uow, outbox, members),
            trace,
            saved,
            appended
        };
    }

    /** An active admin named Ada, the member every patch below targets. */
    function ada(id = MEMBER_ID): Member {
        return Member.rehydrate({
            id,
            email: 'ada@example.com',
            name: 'Ada',
            roleKey: 'admin',
            status: 'active'
        });
    }

    /** A patch body, typed as the DTO the controller would hand over. */
    function patch(dto: Partial<UpdateMemberDto>): UpdateMemberDto {
        return dto as UpdateMemberDto;
    }

    describe('which loader takes the lock', () => {
        it('loads a role patch under the active-admin lock', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ role: 'viewer' })
            );

            expect(test.trace).toContain('findByIdForAdminGuard');
            expect(test.trace).not.toContain('findById');
        });

        it('loads a name-only patch unlocked', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ name: 'Ada Lovelace' })
            );

            // A rename cannot move the admin count, and the lock is a single
            // global key — making renames wait serialised every member edit in
            // the deployment behind one lock.
            expect(test.trace).toContain('findById');
            expect(test.trace).not.toContain('findByIdForAdminGuard');
        });
    });

    describe('self-action guard', () => {
        it('refuses to change your own role', async () => {
            const test = harness(ada(ACTOR_ID));

            await expect(
                test.useCase.execute(ACTOR, ACTOR_ID, patch({ role: 'viewer' }))
            ).rejects.toBeInstanceOf(SelfActionError);
            expect(test.saved).toHaveLength(0);
        });

        it('allows renaming yourself', async () => {
            const test = harness(ada(ACTOR_ID));

            await test.useCase.execute(
                ACTOR,
                ACTOR_ID,
                patch({ name: 'Ada L.' })
            );

            // The guard is deliberately about *role*, not about the account:
            // editing your own display name is ordinary, and nothing else in
            // the suite says so.
            expect(test.saved).toHaveLength(1);
            expect(test.saved[0].name).toBe('Ada L.');
        });
    });

    describe('what reaches the outbox', () => {
        it('appends both facts when a patch changes name and role [users:I-14]', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ name: 'Ada Lovelace', role: 'viewer' })
            );

            // Two distinct audit rows downstream: the aggregate raises the role
            // change, the application mints the rename.
            expect(test.appended.map((event) => event.kind)).toEqual([
                MEMBER_EVENT_KINDS.ROLE_CHANGED,
                MEMBER_EVENT_KINDS.PROFILE_UPDATED
            ]);
            expect(test.appended[1].payload).toMatchObject({
                name: { from: 'Ada', to: 'Ada Lovelace' }
            });
        });

        it('writes nothing when the patch changes neither [users:I-14]', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ name: 'Ada', role: 'admin' })
            );

            expect(test.saved).toHaveLength(0);
            expect(test.appended).toHaveLength(0);
            expect(test.trace).not.toContain('outbox:append');
        });

        it('stamps the actor on every appended event [users:I-14]', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ name: 'Ada Lovelace', role: 'viewer' })
            );

            for (const event of test.appended) {
                expect(event.payload).toMatchObject({
                    actor: { id: ACTOR.id, email: ACTOR.email }
                });
            }
        });

        it('appends inside the unit of work, not after it [users:I-14]', async () => {
            const test = harness(ada());

            await test.useCase.execute(
                ACTOR,
                MEMBER_ID,
                patch({ name: 'Ada Lovelace' })
            );

            // The outbox row and the state change are one transaction or
            // neither — an append after `uow:exit` would commit on its own
            // connection and could outlive a rolled-back update.
            expect(test.trace).toEqual([
                'uow:enter',
                'findById',
                'save',
                'outbox:append',
                'uow:exit'
            ]);
        });
    });
});
