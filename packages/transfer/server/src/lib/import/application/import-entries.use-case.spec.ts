import {
    CONFLICT_POLICIES,
    CONFLICT_POLICY,
    IMPORT_ACTION,
    IMPORT_REASON,
    RELATION_POLICIES,
    RELATION_POLICY,
    type ConflictPolicy,
    type ImportAction,
    type ImportReason,
    type RelationPolicy
} from '@orthacms/transfer-domain';
import { ImportEntriesUseCase } from './import-entries.use-case';

/**
 * The policy decision, called on the real prototype.
 *
 * `decide` is a private pure method: it reads no `this`, touches no database,
 * and is the single switch both policies pass through. Reaching it this way
 * exercises the production code rather than a paraphrase of it — the
 * alternative is a container, a Postgres and thirty rows of fixture to observe
 * one `if`.
 */
const decide = (
    ImportEntriesUseCase.prototype as unknown as {
        decide(
            keyable: boolean,
            match: { targetId: string } | undefined,
            policy: ConflictPolicy | RelationPolicy
        ): { action: ImportAction; reason: ImportReason };
    }
).decide;

/** All seven policy settings — four conflict, three relation. */
const EVERY_POLICY: (ConflictPolicy | RelationPolicy)[] = [
    ...CONFLICT_POLICIES,
    ...RELATION_POLICIES
];

const MATCH = { targetId: 'existing-1' };

describe('no match means a create', () => {
    it('has seven policies to answer for', () => {
        // The loop below is only as good as its input, and the invariant says
        // "every one of the seven".
        expect(EVERY_POLICY).toHaveLength(7);
    });

    it.each(EVERY_POLICY)(
        'creates under %s when nothing matched [transfer:I-13]',
        (policy) => {
            // `recreate` included, and `fail` and `skip` too: a related record
            // with nothing to link to has to be written, or the link it exists
            // to serve would dangle. There is no policy under which "not here"
            // means "do nothing".
            expect(decide(true, undefined, policy).action).toBe(
                IMPORT_ACTION.Create
            );
        }
    );

    it('says why: new when the record was keyable, no-identity when it was not [transfer:I-13]', () => {
        expect(decide(true, undefined, CONFLICT_POLICY.Skip).reason).toBe(
            IMPORT_REASON.New
        );
        expect(decide(false, undefined, CONFLICT_POLICY.Skip).reason).toBe(
            IMPORT_REASON.NoIdentity
        );
    });

    it.each(EVERY_POLICY)(
        'does not create under %s when something did match',
        (policy) => {
            // The control. Without it, a `decide` that returned Create
            // unconditionally would satisfy every case above.
            const created = decide(true, MATCH, policy).action;
            const expected =
                policy === CONFLICT_POLICY.Duplicate ||
                policy === RELATION_POLICY.Recreate;

            expect(created === IMPORT_ACTION.Create).toBe(expected);
        }
    );
});

describe('a match is answered by whichever policy governs the record', () => {
    it.each([
        [
            CONFLICT_POLICY.Skip,
            IMPORT_ACTION.Skip,
            IMPORT_REASON.ConflictSkipped
        ],
        [CONFLICT_POLICY.Update, IMPORT_ACTION.Update, IMPORT_REASON.Matched],
        [
            CONFLICT_POLICY.Duplicate,
            IMPORT_ACTION.Create,
            IMPORT_REASON.ConflictDuplicated
        ],
        [CONFLICT_POLICY.Fail, IMPORT_ACTION.Error, IMPORT_REASON.Matched],
        [
            RELATION_POLICY.Link,
            IMPORT_ACTION.Skip,
            IMPORT_REASON.RelationLinked
        ],
        [RELATION_POLICY.Update, IMPORT_ACTION.Update, IMPORT_REASON.Matched],
        [
            RELATION_POLICY.Recreate,
            IMPORT_ACTION.Create,
            IMPORT_REASON.RelationRecreated
        ]
    ])('%s → %s', (policy, action, reason) => {
        expect(decide(true, MATCH, policy)).toEqual({ action, reason });
    });

    it('distinguishes a linked relation from a skipped conflict', () => {
        // They are the same action and deliberately different reasons: one is
        // the intent ("point at the author who is already here"), the other is
        // a conflict declined. Collapsing them would make the verdict list lie
        // about what happened.
        expect(decide(true, MATCH, RELATION_POLICY.Link).reason).not.toBe(
            decide(true, MATCH, CONFLICT_POLICY.Skip).reason
        );
    });
});

/**
 * **`transfer:I-09`, the first clause** — "the apply runs entirely in one
 * transaction".
 *
 * The second clause is pinned in `import-media.service.spec.ts`: the rollback
 * list belongs to the caller's run, not to the singleton. The first was pinned
 * by nothing, and it is the one the invariant leads with — a half-imported
 * graph is worse than no import, because nobody can tell which half is real.
 *
 * The observable is `execute` itself, driven on the real prototype with the
 * body stubbed. `UnitOfWork.run` is what a transaction *is* here — a nested
 * `run` joins the outer one and every repository takes its executor from
 * `current()` — so "the whole apply happens inside exactly one `uow.run`" is
 * the claim, stated where it is decided. What is *not* reachable this way is
 * Postgres actually undoing the earlier rows; that is `UnitOfWork`'s own
 * guarantee, held in `apps/server-e2e/src/server/database/`.
 */
describe('the apply is one transaction', () => {
    /** An `execute` on the real prototype, with the run body swapped out. */
    function useCase(options: { fails?: Error } = {}) {
        const calls: string[] = [];
        const rolledBack: unknown[] = [];

        // Typed as a bare shape rather than the class: `uow`, `media` and
        // `run` are `private`, so intersecting the class with an object type
        // naming them collapses to `never`.
        const instance = Object.create(
            ImportEntriesUseCase.prototype
        ) as unknown as {
            uow: unknown;
            media: unknown;
            run: () => Promise<unknown>;
            execute: (command: unknown) => Promise<unknown>;
        };

        instance.uow = {
            run: async (fn: () => Promise<unknown>) => {
                calls.push('uow.run:enter');
                try {
                    return await fn();
                } finally {
                    calls.push('uow.run:exit');
                }
            }
        };
        instance.media = {
            rollbackRun: async (run: unknown) => {
                calls.push('media.rollbackRun');
                rolledBack.push(run);
            }
        };
        // Shadows the prototype's private `run`, so `execute` is the only
        // production code under test here.
        instance.run = async () => {
            calls.push('run');
            if (options.fails) throw options.fails;
            return { ok: true };
        };

        return { instance, calls, rolledBack };
    }

    const command = { dryRun: false };

    it('opens exactly one transaction, and runs inside it [transfer:I-09]', async () => {
        const { instance, calls } = useCase();

        await instance.execute(command);

        expect(calls).toEqual(['uow.run:enter', 'run', 'uow.run:exit']);
    });

    it('opens none at all for a dry run [transfer:I-09]', async () => {
        // The control: without it, a `uow.run` that had become unconditional —
        // or an `execute` that opened one per record — would still show a
        // transaction around the case above and prove nothing about *one*.
        const { instance, calls } = useCase();

        await instance.execute({ dryRun: true });

        expect(calls).toEqual(['run']);
    });

    it('deletes the blobs the transaction cannot roll back [transfer:I-09]', async () => {
        // Asset bytes are the one thing outside the transaction, so a failed
        // apply has to remove them by hand or they are orphaned forever.
        const failure = new Error('a record would not write');
        const { instance, calls, rolledBack } = useCase({ fails: failure });

        await expect(instance.execute(command)).rejects.toBe(failure);

        expect(calls).toEqual([
            'uow.run:enter',
            'run',
            'uow.run:exit',
            'media.rollbackRun'
        ]);
        // The run handed to the rollback is the one this apply began — the
        // caller-owned handle the second clause is about.
        expect(rolledBack).toHaveLength(1);
    });
});
