import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COMBINATOR, OP, isRule } from '../../types/filter-tree.type';
import type { FilterGroup, FilterRule } from '../../types/filter-tree.type';
import {
    ControlledBuilder,
    flushFrame,
    group,
    renderIntl,
    rule
} from '../__test__/harness';

/**
 * The builder's own behaviour, as opposed to the wire format on either side of
 * it. These live here rather than in `admin-e2e` because each one is a claim
 * about what the component does with a *tree the consumer hands it* — an
 * unresolvable field id, a subgroup, a row that is about to unmount — and the
 * e2e suite reaches the builder only through a list page that builds one flat
 * rule in the root group.
 */

/** The last tree a spy `onChange` was handed. */
function lastTree(onChange: ReturnType<typeof vi.fn>): FilterGroup {
    return onChange.mock.calls.at(-1)?.[0] as FilterGroup;
}

/** The leaves of a group, in order — subgroups skipped. */
function rulesOf(g: FilterGroup): FilterRule[] {
    return g.children.filter(isRule);
}

/** A subgroup by index among its parent's subgroups. */
function subgroupsOf(g: FilterGroup): FilterGroup[] {
    return g.children.filter((c): c is FilterGroup => !isRule(c));
}

describe('QueryBuilder', () => {
    describe('a rule always has a field', () => {
        it('adds nothing at all rather than a rule with no field [query-builder:I-03]', () => {
            // The one state the model has no room for. `Add rule` seeds the
            // row from `fields[0]`; with no fields there is nothing to seed it
            // with, and the honest answer is to add no row — a row carrying
            // `fieldId: ''` would render a picker on a field that does not
            // exist and could never pass the Apply gate.
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder
                    initial={null}
                    fields={[]}
                    onChange={onChange}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

            expect(onChange).not.toHaveBeenCalled();
            expect(screen.queryByRole('combobox')).toBeNull();
        });

        it('offers re-picking instead of clearing the field [query-builder:I-03]', () => {
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'title', OP.Contains, 'draft')
                    ])}
                />
            );

            const fieldTrigger = screen.getByRole('combobox', {
                name: 'Field for Title'
            });
            // The field cell holds exactly one control. A destructive "clear"
            // would be a second one beside the trigger, and it would put the
            // rule into the field-less state above; the affordance for changing
            // the field is the trigger itself, which simply reopens the picker.
            const cell = fieldTrigger.parentElement as HTMLElement;
            expect(cell.querySelectorAll('button')).toHaveLength(1);

            fireEvent.click(fieldTrigger);
            const listbox = screen.getByRole('listbox');
            // Reopening lands on the current field, marked as the selected one.
            expect(
                within(listbox)
                    .getByRole('option', { name: 'Title' })
                    .getAttribute('aria-selected')
            ).toBe('true');
        });
    });

    describe('an unresolvable field', () => {
        /** A tree naming a field the schema no longer declares. */
        const stale = () =>
            group('root', [rule('r1', 'ghost', OP.Contains, 'x')]);

        it('is reported, not silently replaced by the first field [query-builder:I-04]', () => {
            renderIntl(<ControlledBuilder initial={stale()} />);

            // `showErrors` is off — the default, and what a freshly opened
            // panel is in. An unknown field is a broken rule rather than an
            // unfinished one, so it announces itself anyway.
            expect(screen.getByTestId('qb-rule-error').textContent).toContain(
                'no longer available'
            );
            // The row must not read as "Title contains x": substituting
            // `fields[0]` would drive the operator list and the validation off
            // the wrong type while `ghost` stayed on the wire.
            const trigger = screen.getByRole('combobox');
            expect(trigger.textContent).toContain('Field');
            expect(trigger.textContent).not.toContain('Title');
        });

        it('leaves the operator and value cells undrawn [query-builder:I-04]', () => {
            renderIntl(<ControlledBuilder initial={stale()} />);

            // One combobox in the row, not two: with no field there is no type
            // to draw an operator list from. A substituted `fields[0]` would
            // give the row a full, plausible-looking set of controls.
            expect(screen.getAllByRole('combobox')).toHaveLength(1);
            expect(screen.queryByRole('textbox')).toBeNull();
        });

        it('keeps the field cell, so re-picking is the fix [query-builder:I-04]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder initial={stale()} onChange={onChange} />
            );

            fireEvent.click(screen.getByRole('combobox'));
            fireEvent.click(
                within(screen.getByRole('listbox')).getByRole('option', {
                    name: 'Title'
                })
            );

            expect(rulesOf(lastTree(onChange))[0]).toMatchObject({
                fieldId: 'title'
            });
            expect(screen.queryByTestId('qb-rule-error')).toBeNull();
        });
    });

    describe('changing a rule’s field or operator', () => {
        it('resets the operator and the value to the new field’s own default [query-builder:I-05]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'title', OP.Contains, 'draft')
                    ])}
                    onChange={onChange}
                />
            );

            fireEvent.click(
                screen.getByRole('combobox', { name: 'Field for Title' })
            );
            fireEvent.click(
                within(screen.getByRole('listbox')).getByRole('option', {
                    name: 'Can be seen by'
                })
            );

            // `contains` is not in the enum field's list at all, so carrying it
            // over is a 400 on the wire; and the audience field declares
            // `is_one_of` first, so the seeded operator has to come from
            // `opsForField` rather than from the type's `equals`-first order.
            // The value follows the operator's *shape* — an `is_one_of` left
            // holding `'draft'` breaks the multi-select on the next render.
            expect(rulesOf(lastTree(onChange))[0]).toEqual({
                id: 'r1',
                fieldId: 'audience',
                op: OP.IsOneOf,
                value: []
            });
        });

        it('re-seeds the value by the new operator’s shape [query-builder:I-05]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'views', OP.Equals, '5')
                    ])}
                    onChange={onChange}
                />
            );

            const operator = screen.getByRole('combobox', {
                name: 'Operator for Views'
            });
            fireEvent.keyDown(operator, { key: 'Enter' });
            fireEvent.click(screen.getByRole('option', { name: 'between' }));

            // `between` is a two-bound editor. Leaving `'5'` there hands two
            // controlled `<input>`s an undefined `value` on the next render —
            // React's controlled → uncontrolled transition — and serialises
            // into a `gte`/`lte` pair with no bounds.
            expect(rulesOf(lastTree(onChange))[0]).toEqual({
                id: 'r1',
                fieldId: 'views',
                op: OP.Between,
                value: { from: '', to: '' }
            });
        });
    });

    describe('groups', () => {
        /** Root AND holding a rule and two sibling subgroups, each with a rule. */
        const nested = () =>
            group('root', [
                rule('r0', 'title', OP.Contains, 'a'),
                group('g1', [rule('r1', 'views', OP.Equals, '1')]),
                group('g2', [rule('r2', 'views', OP.Equals, '2')])
            ]);

        it('gives every group its own combinator, addressed by id [query-builder:I-11]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder initial={nested()} onChange={onChange} />
            );

            // Flip the *second* subgroup. There is no global AND/OR mode: the
            // root and the untouched sibling must both still read `and`.
            fireEvent.click(
                within(
                    screen.getByRole('radiogroup', {
                        name: 'Combinator for group 2'
                    })
                ).getByRole('radio', { name: 'OR' })
            );

            let tree = lastTree(onChange);
            expect(tree.combinator).toBe(COMBINATOR.And);
            expect(subgroupsOf(tree).map((g) => g.combinator)).toEqual([
                COMBINATOR.And,
                COMBINATOR.Or
            ]);

            // And the root's own switch reaches the root only — a group that
            // read its combinator from a shared setting would flip with it.
            fireEvent.click(
                within(
                    screen.getByRole('radiogroup', { name: 'Combinator' })
                ).getByRole('radio', { name: 'OR' })
            );

            tree = lastTree(onChange);
            expect(tree.combinator).toBe(COMBINATOR.Or);
            expect(subgroupsOf(tree).map((g) => g.combinator)).toEqual([
                COMBINATOR.And,
                COMBINATOR.Or
            ]);
        });

        it('adds a rule to the group that asked for it, not to the root [query-builder:I-11]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder initial={nested()} onChange={onChange} />
            );

            fireEvent.click(
                screen.getByRole('button', { name: 'Add rule to group 2' })
            );

            const tree = lastTree(onChange);
            // The root keeps its single leaf; the addressed subgroup gains one
            // and its sibling does not. Appending by position — or to whichever
            // group rendered the button's parent — lands somewhere else.
            expect(rulesOf(tree)).toHaveLength(1);
            expect(subgroupsOf(tree).map((g) => g.children.length)).toEqual([
                1, 2
            ]);
        });

        it('nests a new subgroup inside the group that asked for it [query-builder:I-11]', () => {
            const onChange = vi.fn();
            renderIntl(
                <ControlledBuilder initial={nested()} onChange={onChange} />
            );

            fireEvent.click(
                screen.getByRole('button', {
                    name: 'Add group inside group 1'
                })
            );

            const tree = lastTree(onChange);
            expect(subgroupsOf(tree)).toHaveLength(2);
            expect(subgroupsOf(subgroupsOf(tree)[0])).toHaveLength(1);
            expect(subgroupsOf(subgroupsOf(tree)[1])).toHaveLength(0);
        });
    });

    describe('focus after a deletion', () => {
        /** Three rows, each on a different field so their controls are named apart. */
        const three = () =>
            group('root', [
                rule('r1', 'title', OP.Contains, 'a'),
                rule('r2', 'views', OP.Equals, '1'),
                rule('r3', 'publishedAt', OP.Gt, '')
            ]);

        const removeButton = (name: string) =>
            screen.getByRole('button', { name: `Remove condition: ${name}` });

        it('moves to the next row rather than falling out of the builder [query-builder:I-18]', async () => {
            renderIntl(<ControlledBuilder initial={three()} />);

            fireEvent.click(removeButton('Views'));
            await flushFrame();

            // The removed row's button unmounts with it, so focus would land on
            // `<body>` and the next Tab would restart at the top of the
            // document. The target is captured before the unmount, so it is the
            // row that was below — the direction the list is being read in.
            expect(document.activeElement).toBe(removeButton('Published at'));
        });

        it('falls back to the previous row when the last one goes [query-builder:I-18]', async () => {
            renderIntl(<ControlledBuilder initial={three()} />);

            fireEvent.click(removeButton('Published at'));
            await flushFrame();

            expect(document.activeElement).toBe(removeButton('Views'));
        });

        it('lands on “Add rule” when the builder empties [query-builder:I-18]', async () => {
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'title', OP.Contains, 'a')
                    ])}
                />
            );

            fireEvent.click(removeButton('Title'));
            await flushFrame();

            expect(document.activeElement).toBe(
                screen.getByRole('button', { name: 'Add rule' })
            );
            // …and still inside the builder, which is the whole claim.
            expect(document.activeElement).not.toBe(document.body);
        });

        it('keeps focus inside the builder when a subgroup is removed [query-builder:I-18]', async () => {
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'title', OP.Contains, 'a'),
                        group('g1', [])
                    ])}
                />
            );

            fireEvent.click(
                screen.getByRole('button', { name: 'Remove group 1' })
            );
            await flushFrame();

            expect(document.activeElement).toBe(removeButton('Title'));
        });
    });

    describe('the field schema is read by id throughout', () => {
        it('drives the operator list off the resolved field, not the first one [query-builder:I-04]', () => {
            renderIntl(
                <ControlledBuilder
                    initial={group('root', [
                        rule('r1', 'audience', OP.IsOneOf, [])
                    ])}
                />
            );

            fireEvent.keyDown(
                screen.getByRole('combobox', {
                    name: 'Operator for Segmentation · Can be seen by'
                }),
                { key: 'Enter' }
            );

            // The audience field narrows its own operators to two. Resolving
            // the row against `FIELDS[0]` (a string) would offer eight.
            expect(
                screen
                    .getAllByRole('option')
                    .map((o) => o.textContent)
                    .filter((t) => t)
            ).toEqual(['is one of', 'equals']);
        });
    });
});
