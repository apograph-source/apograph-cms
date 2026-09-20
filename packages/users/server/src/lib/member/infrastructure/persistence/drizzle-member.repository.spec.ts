import type { UnitOfWork } from '@orthacms/database';
import { Member } from '../../domain/member';
import { Role } from '../../domain/value-objects/role';
import { EmailTakenError } from '../../domain/errors';
import { MemberMapper } from './member.mapper';
import { DrizzleMemberRepository } from './drizzle-member.repository';

const ROLE_ID = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'grace@example.com';

/**
 * The insert path's unique-violation mapping — the DB's case-insensitive email
 * index is the race-proof backstop behind the invite's up-front check, and this
 * is the translation that turns it into a `409 EMAIL_TAKEN` rather than a 500.
 *
 * Worth its own test because the detection is a **cause walk**, not a field
 * read: `pg` throws the `23505` on the driver error, but Drizzle wraps it, so
 * the code lives one (sometimes two) `.cause` hops down. A walk that stopped at
 * the top level would compile, pass every other test in the suite, and answer
 * 500 to a duplicate invite; a walk with the wrong loop condition would spin
 * forever on a non-Error cause. Neither is visible from the outside except
 * here.
 */
describe('DrizzleMemberRepository.save (new member)', () => {
    /** A repository whose `insert` rejects with `failure`. */
    function repositoryThatFails(failure: unknown): DrizzleMemberRepository {
        const executor = {
            // `roleIdByKey` runs first: select → from → where → limit.
            select: () => ({
                from: () => ({
                    where: () => ({
                        limit: async () => [{ id: ROLE_ID }]
                    })
                })
            }),
            insert: () => ({
                values: async () => {
                    throw failure;
                }
            })
        };
        const uow = { current: () => executor } as unknown as UnitOfWork;
        return new DrizzleMemberRepository(uow, new MemberMapper());
    }

    /** A brand-new (`isNew`) aggregate, so `save` takes the insert branch. */
    function newMember(): Member {
        return Member.invite({
            email: EMAIL,
            name: 'Grace',
            role: Role.create('contributor')
        });
    }

    /** Saves a new member against an insert that throws `failure`. */
    function save(failure: unknown): Promise<void> {
        return repositoryThatFails(failure).save(newMember());
    }

    /** An `Error` carrying a driver `code`, optionally over a `cause`. */
    function pgError(code: string, cause?: unknown): Error {
        const error = new Error(`duplicate key value`, { cause });
        return Object.assign(error, { code });
    }

    it('maps a top-level 23505 to EmailTakenError naming the member', async () => {
        const thrown = await save(pgError('23505')).catch(
            (error: unknown) => error
        );

        expect(thrown).toBeInstanceOf(EmailTakenError);
        expect((thrown as EmailTakenError).email).toBe(EMAIL);
        expect((thrown as EmailTakenError).code).toBe('EMAIL_TAKEN');
    });

    it('maps a 23505 one cause down — the shape Drizzle actually throws', async () => {
        const wrapped = new Error('Failed query', {
            cause: pgError('23505')
        });

        await expect(save(wrapped)).rejects.toBeInstanceOf(EmailTakenError);
    });

    it('maps a 23505 two causes down', async () => {
        const wrapped = new Error('outer', {
            cause: new Error('middle', { cause: pgError('23505') })
        });

        await expect(save(wrapped)).rejects.toBeInstanceOf(EmailTakenError);
    });

    it('rethrows a different constraint violation unchanged', async () => {
        // 23503 is a foreign-key violation — a real bug, not a duplicate email.
        // Rethrowing the *same object* keeps its stack and its driver detail,
        // which is the whole value of a 500 here.
        const foreignKey = pgError('23503');

        await expect(save(foreignKey)).rejects.toBe(foreignKey);
    });

    it('stops the walk at a non-Error cause instead of looping on it', async () => {
        // `cause` is untyped, so nothing stops it being a string. The loop
        // condition is `current instanceof Error`, so this terminates; a
        // `while (current)` walk reading `.cause` off a primitive would spin
        // forever and this test would time out rather than fail.
        const stringCause = new Error('wrapped', { cause: '23505' });

        await expect(save(stringCause)).rejects.toBe(stringCause);
    });

    it('rethrows a plain object carrying 23505 — the walk only visits Errors', async () => {
        // Documenting the boundary rather than asserting a wish: the walk is
        // `for (current = error; current instanceof Error; …)`, so a bare
        // `{ code: '23505' }` never enters the loop and reaches the caller
        // unmapped. Harmless in practice — `pg`'s `DatabaseError` extends
        // `Error`, so a real violation is always an Error — but it is what the
        // code does, and a test claiming otherwise would be the thing that's
        // wrong.
        const bare = { code: '23505' };

        await expect(save(bare)).rejects.toBe(bare);
    });
});
