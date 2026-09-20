import { getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@orthacms/database';
import { ConversationRepository } from './conversation.repository';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';

/** One recorded statement: where it was rooted, what it set, and its filter. */
interface Statement {
    kind: 'select' | 'update';
    table: string;
    set?: Record<string, unknown>;
    where?: SQL;
}

/**
 * A `Database` that records the **real** Drizzle expressions the repository
 * built and answers every read with `rows`.
 *
 * Same technique as `proposal.repository.spec.ts`, for the same reason: the
 * expression is rendered through the dialect the driver uses, so a predicate
 * that was dropped is a predicate missing from the rendered statement. There is
 * nowhere for the test to agree with a stub instead of with the code.
 *
 * It also records **reads**, which is what makes the append below checkable at
 * all: "appended in SQL" and "read, changed in JavaScript, written back" differ
 * by exactly one `SELECT`.
 */
function fakeDb(rows: unknown[] = []) {
    const statements: Statement[] = [];
    const settled = () => {
        const promise = Promise.resolve(rows);
        return {
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            returning: () => Promise.resolve(rows),
            then: promise.then.bind(promise)
        };
    };
    const db = {
        select() {
            return {
                from(table: object) {
                    return {
                        where(where: SQL) {
                            statements.push({
                                kind: 'select',
                                table: getTableName(table as never),
                                where
                            });
                            return settled();
                        }
                    };
                }
            };
        },
        update(table: object) {
            return {
                set(values: Record<string, unknown>) {
                    return {
                        where(where: SQL) {
                            statements.push({
                                kind: 'update',
                                table: getTableName(table as never),
                                set: values,
                                where
                            });
                            return settled();
                        }
                    };
                }
            };
        }
    };
    return {
        repo: new ConversationRepository(db as unknown as Database),
        statements
    };
}

/** The SQL and bound parameters one expression renders to. */
const render = (expression: SQL) => new PgDialect().sqlToQuery(expression);

/**
 * "Allow for this chat" is written **in the database**, not read out, changed
 * and written back.
 *
 * The difference is only ever visible under concurrency, which is precisely the
 * case it exists for: a single turn can ask about two writes, both prompts are
 * live at once while the run is parked, and answering "allow for this chat" on
 * each fires two of these within milliseconds. A read-modify-write loses one —
 * whichever read first writes last, and the tool it authorised asks again on the
 * next turn as though the user had never answered.
 *
 * No test that drives the engine can see that: the two orders differ only in a
 * race, and the effect a passing run observes (the second call in a turn is not
 * asked again) holds for both. The statement itself is the observable.
 */
describe('ConversationRepository.allowTool', () => {
    it('appends to the allow list in SQL, without reading it first [copilot:I-08]', async () => {
        const { repo, statements } = fakeDb();

        await repo.allowTool(CONVERSATION, 'content_propose_update');

        // One statement, and it is the write. A read-modify-write needs a
        // `SELECT` here to have something to modify.
        expect(statements).toHaveLength(1);
        expect(statements[0]).toMatchObject({
            kind: 'update',
            table: 'copilot_conversations'
        });

        // The new value is an expression, not an array the process computed:
        // an implementation that set `allowedTools: [...previous, name]` would
        // hand Drizzle a plain value here.
        const value = statements[0].set?.['allowedTools'];
        expect(value).toBeInstanceOf(SQL);

        const written = render(value as SQL);
        // The existing column is an *input* to its own new value — which is
        // what makes the append happen inside the transaction rather than in
        // this process.
        expect(written.sql).toContain('"allowed_tools"');
        // And the only thing bound is the name being added: nothing read
        // beforehand travels back into the statement.
        expect(written.params).toEqual(['["content_propose_update"]']);
    });

    /**
     * The read half of the pair, and the reason the write must be an append at
     * all: the list is re-read per call rather than snapshotted per run, so the
     * second of two calls in one turn sees what the first was allowed.
     */
    it('reads the allow list from the row each time it is asked [copilot:I-08]', async () => {
        const { repo, statements } = fakeDb([
            { allowedTools: ['content_propose_update'] }
        ]);

        await repo.allowedTools(CONVERSATION);
        await repo.allowedTools(CONVERSATION);

        expect(statements.map((entry) => entry.kind)).toEqual([
            'select',
            'select'
        ]);
    });
});

/**
 * Ownership, and the conflation that follows from where it is enforced.
 *
 * The invariant has two halves, and the second is a *consequence* of the first
 * rather than a separate branch: because the caller's `userId` and
 * `workspaceId` are predicates in the statement, a thread that does not exist
 * and a thread that is somebody else's produce the same empty result, reached by
 * the same line. There is no code path that could answer them differently — and
 * that is the thing to assert, because the way this stops being true is somebody
 * adding a read that looks the id up first "to give a better error".
 */
describe('ConversationRepository ownership', () => {
    it.each([
        [
            'find',
            (repo: ConversationRepository) =>
                repo.find(CONVERSATION, USER, WORKSPACE)
        ],
        [
            'findOrFail',
            (repo: ConversationRepository) =>
                repo.findOrFail(CONVERSATION, USER, WORKSPACE).catch(() => null)
        ],
        [
            'update',
            (repo: ConversationRepository) =>
                repo.update(CONVERSATION, USER, WORKSPACE, { title: 'New' })
        ]
    ])(
        '%s filters on the caller and the workspace, in one statement [copilot:I-30]',
        async (_name, call) => {
            const { repo, statements } = fakeDb([]);

            await call(repo);

            expect(statements).toHaveLength(1);
            const filter = render(statements[0].where as SQL);
            expect(filter.params).toEqual([CONVERSATION, USER, WORKSPACE]);
        }
    );

    it('lists only the caller’s threads in the named workspace [copilot:I-30]', async () => {
        const { repo, statements } = fakeDb([]);

        await repo.list(USER, WORKSPACE);

        expect(render(statements[0].where as SQL).params).toEqual([
            USER,
            WORKSPACE,
            false
        ]);
    });

    /**
     * "No such thing" and "not yours" are the same answer because they are the
     * same zero rows: one statement, one empty result, one message that names
     * nothing about the id it was given.
     */
    it('gives an id that is not the caller’s the same answer as one that does not exist [copilot:I-30]', async () => {
        const { repo, statements } = fakeDb([]);

        await expect(
            repo.findOrFail(CONVERSATION, USER, WORKSPACE)
        ).rejects.toThrow('Conversation not found.');

        // The statement the answer came from could not have told the two apart:
        // both ids reach it, both match nothing, and nothing else was asked.
        expect(statements).toHaveLength(1);
        expect(await repo.find(CONVERSATION, USER, WORKSPACE)).toBeNull();
    });
});
