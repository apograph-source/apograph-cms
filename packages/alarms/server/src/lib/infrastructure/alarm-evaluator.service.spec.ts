import { Logger } from '@nestjs/common';
import {
    CONTENT_FIELD_TYPE,
    type AnyContentType
} from '@apograph/content-server';
import { AlarmEvaluator } from './alarm-evaluator.service';
import type { AlarmRuleRecord } from './alarm-rule.repository';
import {
    ALARMS_DEFAULTS,
    type ResolvedAlarmsConfig
} from '../types/alarms-config';

/**
 * The three evaluation paths, driven against a recording matcher and a
 * recording finding store.
 *
 * These are the two collaborators the invariants are *about*: "one
 * `EntryMatchQuery` and one `AlarmFindingStore.reconcile`, differing only in
 * the set of rows examined" is a statement about which calls each path makes,
 * and about the arguments it makes them with. A database would not make it more
 * visible — the server-e2e suite already establishes that findings open and
 * close over real content — it would hide the arguments behind their effects.
 *
 * What the stubs must not do is soften the boundaries. `matchingIds` records
 * every call, including the ceiling and the limits it was handed, so a pass
 * that dropped a bound reads as a call with `limit: undefined` rather than as a
 * larger result the stub would have had to invent.
 */

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const AUTHOR_TYPE = { name: 'author', fields: {} } as unknown as AnyContentType;

const ARTICLE_TYPE = {
    name: 'article',
    fields: {
        status: { type: CONTENT_FIELD_TYPE.Text },
        author: {
            type: CONTENT_FIELD_TYPE.Relation,
            relation: { to: () => AUTHOR_TYPE }
        },
        cover: { type: CONTENT_FIELD_TYPE.Media }
    }
} as unknown as AnyContentType;

function rule(overrides: Partial<AlarmRuleRecord> = {}): AlarmRuleRecord {
    return {
        id: 'rule-1',
        workspaceId: WORKSPACE,
        contentType: 'article',
        name: 'Live records point at published authors',
        findingTitle: 'Author is not published',
        severity: 'warn',
        filter: {
            and: [
                { field: 'status', op: 'eq', value: 'published' },
                { field: 'author.status', op: 'ne', value: 'published' }
            ]
        },
        enabled: true,
        brokenReason: null,
        ...overrides
    };
}

interface MatchCall {
    type: AnyContentType;
    filter: unknown;
    workspaceId: string;
    options: { entryIds?: readonly string[]; limit?: number; offset?: number };
}

/** The relation-field resolver the evaluator hands to the repository. */
type RelationsOf = (contentType: string) => Map<string, string>;

interface ReconcileCall {
    rule: unknown;
    examined: string[];
    matched: string[];
}

/** True for the collection walk a rescan uses to enumerate what exists. */
const isEnumeration = (call: MatchCall) =>
    !call.options.entryIds &&
    JSON.stringify(call.filter) === JSON.stringify({});

function harness(options: {
    rules?: AlarmRuleRecord[];
    dependents?: Array<{ rule: AlarmRuleRecord; relationField: string }>;
    live?: string[];
    respond: (call: MatchCall) => string[];
    config?: Partial<ResolvedAlarmsConfig>;
}) {
    const calls: MatchCall[] = [];
    const reconciles: ReconcileCall[] = [];

    const matches = {
        matchingIds: jest.fn(
            async (
                type: AnyContentType,
                filter: unknown,
                workspaceId: string,
                opts: MatchCall['options'] = {}
            ) => {
                const call: MatchCall = {
                    type,
                    filter,
                    workspaceId,
                    options: opts
                };
                calls.push(call);
                return options.respond(call);
            }
        )
    };

    const findings = {
        reconcile: jest.fn(
            async (
                target: unknown,
                examined: readonly string[],
                matched: readonly string[]
            ) => {
                reconciles.push({
                    rule: target,
                    examined: [...examined],
                    matched: [...matched]
                });
                return { opened: matched.length, resolved: 0 };
            }
        ),
        liveEntryIds: jest.fn(async () => [...(options.live ?? [])]),
        openCount: jest.fn(async () => options.live?.length ?? 0)
    };

    const rules = {
        activeForType: jest.fn(async () => options.rules ?? []),
        // Typed by its signature rather than by its (unused) parameters, so
        // `mock.calls` still carries the resolver the assertions call back.
        byTraversedType: jest.fn<
            Promise<Array<{ rule: AlarmRuleRecord; relationField: string }>>,
            [string, ReadonlySet<string>, RelationsOf]
        >(async () => options.dependents ?? []),
        markBroken: jest.fn(async () => undefined),
        markScanned: jest.fn(async () => undefined)
    };

    const registry = {
        get: (name: string) =>
            name === 'article'
                ? ARTICLE_TYPE
                : name === 'author'
                  ? AUTHOR_TYPE
                  : undefined
    };

    const evaluator = new AlarmEvaluator(
        rules as never,
        findings as never,
        matches as never,
        registry as never,
        { ...ALARMS_DEFAULTS, ...options.config }
    );

    return { evaluator, calls, reconciles, matches, findings, rules };
}

describe('AlarmEvaluator', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
        warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    it('ends all three paths in the same matcher and the same reconcile, differing only in the rows examined [alarms:I-03]', async () => {
        const subject = rule();
        const { evaluator, calls, reconciles } = harness({
            rules: [subject],
            dependents: [{ rule: subject, relationField: 'author' }],
            live: [],
            respond: (call) => {
                // The rescan's collection walk: one short page, so the scan
                // stops after it.
                if (isEnumeration(call)) return ['e3', 'e4'];
                // The reverse pass's "which records link to the changed one"
                // query — a composed tree, not the stored one.
                if (call.filter !== subject.filter) return ['e2'];
                // Every verdict: whatever it was asked about, it matches.
                return [...(call.options.entryIds ?? [])];
            }
        });

        await evaluator.evaluateEntries(WORKSPACE, 'article', ['e1']);
        await evaluator.evaluateDependents(WORKSPACE, 'author', 'a1');
        await evaluator.rescan(subject);

        // One reconcile per path, all three about the same rule object.
        expect(reconciles.map((call) => call.rule)).toEqual([
            subject,
            subject,
            subject
        ]);

        // The rows examined are the only thing that differs — an entry, the
        // records that link to a changed one, the collection.
        expect(reconciles.map((call) => call.examined)).toEqual([
            ['e1'],
            ['e2'],
            ['e3', 'e4']
        ]);

        // And every verdict was reached by handing `EntryMatchQuery` the stored
        // tree **by identity**. A path that re-serialised the condition, or
        // held a second condition format, fails here rather than in a comment.
        const verdicts = calls.filter((call) => call.filter === subject.filter);
        expect(verdicts).toHaveLength(3);
        expect(verdicts.map((call) => call.options.entryIds)).toEqual([
            ['e1'],
            ['e2'],
            ['e3', 'e4']
        ]);
    });

    describe('a rescan', () => {
        it('examines the entries it already flags that the scan window missed [alarms:I-10]', async () => {
            const subject = rule();
            const enumerated: string[] = [];
            const { evaluator, reconciles } = harness({
                live: ['e1', 'ghost'],
                respond: (call) => {
                    if (isEnumeration(call)) {
                        enumerated.push('e1');
                        return ['e1'];
                    }
                    // Nothing matches any more — the rule was fixed, or the
                    // entries were.
                    return [];
                }
            });

            const result = await evaluator.rescan(subject);

            // `ghost` is trashed, or sits past the ceiling: the collection walk
            // never returned it, which is what makes this fixture able to tell
            // the union apart from the window.
            expect(enumerated).not.toContain('ghost');

            // It has to be *examined* and *unmatched*, which is exactly what
            // closes it. Drop the out-of-window union and `ghost` keeps an open
            // finding forever, with nothing left that would ever look at it.
            expect(reconciles).toHaveLength(1);
            expect(reconciles[0].examined).toEqual(['e1', 'ghost']);
            expect(reconciles[0].matched).toEqual([]);

            // `scanned` reports the window, not the union: it answers "how much
            // of the collection did we look at".
            expect(result.scanned).toBe(1);
        });

        it('does not count an out-of-window entry twice', async () => {
            const subject = rule();
            const { evaluator, reconciles } = harness({
                live: ['e1'],
                respond: (call) => (isEnumeration(call) ? ['e1'] : ['e1'])
            });

            await evaluator.rescan(subject);

            expect(reconciles[0].examined).toEqual(['e1']);
        });

        it('says so when it hit the scan ceiling [alarms:I-11]', async () => {
            const subject = rule();
            const { evaluator, calls } = harness({
                config: { maxScanEntries: 4, scanBatchSize: 2 },
                // A collection with more entries than the ceiling: every page
                // comes back full.
                respond: (call) =>
                    isEnumeration(call)
                        ? [
                              `p${call.options.offset}a`,
                              `p${call.options.offset}b`
                          ]
                        : []
            });

            const result = await evaluator.rescan(subject);

            // The warning is the whole invariant: a correctness tool that
            // silently stops looking is worse than one that admits it.
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('4-entry scan ceiling')
            );
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining(subject.name)
            );

            // And the report describes the truncated set rather than the
            // collection: four rows examined, not "all of them, clean".
            expect(result.scanned).toBe(4);
            expect(calls.filter(isEnumeration)).toHaveLength(2);
        });

        it('stays quiet when the collection fits inside the ceiling [alarms:I-11]', async () => {
            const subject = rule();
            const { evaluator } = harness({
                config: { maxScanEntries: 4, scanBatchSize: 2 },
                respond: (call) => {
                    if (!isEnumeration(call)) return [];
                    // Three entries: a full page, then a short one.
                    return call.options.offset === 0 ? ['a', 'b'] : ['c'];
                }
            });

            const result = await evaluator.rescan(subject);

            // The negative half. Without it, a rescan that warned on every run
            // would pass the case above and mean nothing.
            expect(warn).not.toHaveBeenCalled();
            expect(result.scanned).toBe(3);
        });
    });

    describe('the reverse pass', () => {
        it('asks only about rules that traverse a relation into the changed type [alarms:I-22]', async () => {
            const { evaluator, rules } = harness({
                dependents: [],
                respond: () => []
            });

            await evaluator.evaluateDependents(WORKSPACE, 'author', 'a1');

            // A workspace with no traversing rule pays one indexed query and
            // stops — no match, no reconcile.
            const [workspaceId, targets, relationsOf] =
                rules.byTraversedType.mock.calls[0];
            expect(workspaceId).toBe(WORKSPACE);
            expect([...targets]).toEqual(['author']);

            // The resolver handed to the repository is what turns a rule's
            // `author.status` leaf into "traverses to an author".
            expect([...relationsOf('article')]).toEqual([['author', 'author']]);
            expect([...relationsOf('unknown')]).toEqual([]);
        });

        it('bounds both the records that link and the records already flagged [alarms:I-22]', async () => {
            const subject = rule();
            const { evaluator, calls, reconciles } = harness({
                config: { maxDependentsPerEvent: 2 },
                dependents: [{ rule: subject, relationField: 'author' }],
                live: ['f1', 'f2', 'f3', 'f4', 'f5'],
                respond: (call) =>
                    call.filter === subject.filter
                        ? []
                        : // The "links to the changed entry" query.
                          ['L1']
            });

            await evaluator.evaluateDependents(WORKSPACE, 'author', 'a1');

            const linked = calls.find((call) => call.filter !== subject.filter);
            expect(linked?.filter).toEqual({
                and: [{ field: 'author.id', op: 'eq', value: 'a1' }]
            });
            expect(linked?.options.limit).toBe(2);

            // The flagged half is bounded in this process rather than in SQL,
            // so it is the slice that has to hold: a rule with thousands of
            // open findings must not turn one publish into a full
            // reconciliation.
            expect(reconciles[0].examined).toEqual(['L1', 'f1', 'f2']);
        });
    });
});
