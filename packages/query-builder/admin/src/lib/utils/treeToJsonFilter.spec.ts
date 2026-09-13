import {
    COMBINATOR,
    OP,
    WITHIN_UNIT,
    type FilterGroup,
    type FilterRule,
    type OpId,
    type RuleValue,
    type WithinUnit
} from '../types/filter-tree.type';
import { treeToJsonNode } from './treeToJsonFilter';

/** A leaf, with the client-side React key filled in for us. */
function rule(fieldId: string, op: OpId, value: RuleValue): FilterRule {
    return { id: `r-${fieldId}-${op}`, fieldId, op, value };
}

/** An AND group of the given children. */
function group(...children: (FilterGroup | FilterRule)[]): FilterGroup {
    return { id: 'g', combinator: COMBINATOR.And, children };
}

/**
 * The serialiser, on the three things about it that are decided **at the call
 * site** and are therefore invisible on screen: when a relative window is
 * frozen, what happens to a draft rule, and what an unmapped operator does.
 *
 * All three are unit-level on purpose. A browser can watch the URL a list page
 * writes, but it cannot watch the one argument that separates a link from a
 * stored rule, and it cannot reach a `throw` that only a future operator
 * triggers.
 */
describe('treeToJsonNode', () => {
    /** Pinned, so a frozen cutoff is a value the test can name. */
    const NOW = new Date('2026-01-15T12:00:00.000Z');

    describe('relativeDates', () => {
        const withinLast = group(
            rule('updatedAt', OP.WithinLast, {
                n: 7,
                unit: WITHIN_UNIT.Days
            })
        );

        it('freezes the cutoff when the filter is going into a link [query-builder:I-21]', () => {
            // The default, and the half that a stored rule must not get. A
            // shared "updated in the last 7 days" link should keep showing the
            // rows the sender saw, so the window is resolved here, once,
            // against `now` — and travels as an absolute `gte`.
            expect(treeToJsonNode(withinLast, NOW)).toEqual({
                and: [
                    {
                        field: 'updatedAt',
                        op: 'gte',
                        value: '2026-01-08T12:00:00.000Z'
                    }
                ]
            });
        });

        it('keeps the window relative when the filter is stored [query-builder:I-21]', () => {
            // The other half, and the reason the option exists: an alarm rule
            // reading "not updated in 90 days" that had frozen its cutoff would
            // mean "not updated since the day the rule was written", for ever,
            // and would look completely normal in the editor while doing it.
            // Nothing on screen distinguishes the two — only this argument.
            expect(
                treeToJsonNode(withinLast, NOW, { relativeDates: true })
            ).toEqual({
                and: [
                    {
                        field: 'updatedAt',
                        op: 'within_last',
                        value: { n: 7, unit: 'days' }
                    }
                ]
            });
        });
    });

    it('throws on an operator with no wire mapping and no branch [query-builder:I-02]', () => {
        // The client never writes a bare operator string: every leaf goes
        // through `UI_TO_WIRE` or through an explicit branch of the serialiser.
        // An operator added to `OP` with neither would otherwise ship
        // `op: undefined` to a server that answers 400 — or, worse, be quietly
        // dropped and widen the filter. The throw is what makes that a build
        // -time-loud mistake for whoever adds the next operator.
        const unmapped = group(rule('title', 'starts_with' as OpId, 'Ada'));

        expect(() => treeToJsonNode(unmapped, NOW)).toThrow(
            /no wire op for starts_with/
        );
    });

    describe('every dictionary is read through Object.hasOwn', () => {
        it('throws rather than shipping an inherited member as the wire op [query-builder:I-08]', () => {
            // `UI_TO_WIRE` is a plain object literal and the op reaches it from
            // a tree that may have been lifted out of a hand-edited `?filter=`
            // or a stored alarm rule. A bare `UI_TO_WIRE[op]` answers
            // `'toString'` with a *function* — truthy, so the throw below never
            // fires and `JSON.stringify` drops the key, quietly widening the
            // filter to everything.
            const inherited = group(rule('title', 'toString' as OpId, 'Ada'));

            expect(() => treeToJsonNode(inherited, NOW)).toThrow(
                /no wire op for toString/
            );
        });

        it('falls back to days for a unit named after a prototype member [query-builder:I-08]', () => {
            // The same lookup, in the window table. `MS_PER_UNIT['constructor']`
            // reads back `Object` under a bare lookup; multiplying it by `n`
            // gives `NaN`, and the clamp then answers with the *earliest
            // representable instant* — a `within_last 7` rule that silently
            // matches every row ever written. The declared fallback is days.
            const bogusUnit = group(
                rule('updatedAt', OP.WithinLast, {
                    n: 7,
                    unit: 'constructor' as WithinUnit
                })
            );

            expect(treeToJsonNode(bogusUnit, NOW)).toEqual({
                and: [
                    {
                        field: 'updatedAt',
                        op: 'gte',
                        value: '2026-01-08T12:00:00.000Z'
                    }
                ]
            });
        });
    });

    describe('what never reaches the wire', () => {
        it('drops a rule the user has not finished [query-builder:I-01]', () => {
            // The user is entitled to hold a draft on screen — the preview
            // serialises the live tree on every keystroke — and the server is
            // not entitled to see it. An `equals` with no value yet is not a
            // filter, and sending it is a 400 on `FILTER_INVALID_VALUE`.
            expect(
                treeToJsonNode(
                    group(
                        rule('title', OP.Contains, 'Ada'),
                        rule('author', OP.Equals, '')
                    ),
                    NOW
                )
            ).toEqual({
                and: [{ field: 'title', op: 'ilike', value: '%Ada%' }]
            });
        });

        it('drops a subgroup whose rules all dropped [query-builder:I-01]', () => {
            // Not the same statement as the one above: a group the user added
            // and never filled would otherwise ship as `{or: []}`, which the
            // server rejects outright with `FILTER_INVALID_NODE` — so one
            // unfinished nested row would 400 the whole list rather than
            // narrowing nothing.
            expect(
                treeToJsonNode(
                    group(rule('title', OP.Contains, 'Ada'), {
                        id: 'sub',
                        combinator: COMBINATOR.Or,
                        children: [rule('author', OP.Equals, '')]
                    }),
                    NOW
                )
            ).toEqual({
                and: [{ field: 'title', op: 'ilike', value: '%Ada%' }]
            });
        });

        it('drops the root itself when nothing survived [query-builder:I-01]', () => {
            // `null`, not an empty group: the consumer's contract is that a
            // null answer removes the `filter` parameter from the URL entirely.
            expect(
                treeToJsonNode(group(rule('author', OP.Equals, '')), NOW)
            ).toBeNull();
        });
    });
});
