import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OP, type FilterGroup } from '../../types/filter-tree.type';
import { FIELDS, group, renderIntl, rule } from '../__test__/harness';
import { QueryBuilderDrawer } from '.';

/**
 * The drawer is published API with **no consumer in this repo**, which is
 * exactly why its half of the draft-lifecycle invariant is pinned here: the
 * admin-e2e suite mounts the panel everywhere and would never notice the
 * drawer's copy of the resync effect being deleted.
 */
function Host({ initial }: { initial: FilterGroup | null }) {
    const [value, setValue] = useState<FilterGroup | null>(initial);
    return (
        <QueryBuilderDrawer
            fields={FIELDS}
            value={value}
            onApply={setValue}
            trigger={<button type="button">Filters</button>}
        />
    );
}

const openDrawer = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
const valueInput = () =>
    screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;

describe('QueryBuilderDrawer', () => {
    it('discards an un-applied edit when it is reopened [query-builder:I-14]', () => {
        renderIntl(
            <Host
                initial={group('root', [
                    rule('r1', 'title', OP.Contains, 'alpha')
                ])}
            />
        );

        openDrawer();
        expect(valueInput().value).toBe('alpha');
        fireEvent.change(valueInput(), { target: { value: 'beta' } });

        // Close without Apply. The drawer keeps its draft in state across the
        // close, so only the resync on open puts the user back on the filter
        // that is actually in force.
        fireEvent.keyDown(valueInput(), { key: 'Escape' });
        openDrawer();

        expect(valueInput().value).toBe('alpha');
    });

    it('clears the previous attempt’s error state on reopening [query-builder:I-14]', () => {
        renderIntl(
            <Host
                initial={group('root', [rule('r1', 'title', OP.Contains, '')])}
            />
        );

        openDrawer();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(screen.getByTestId('qb-rule-error').textContent).toContain(
            'Value required'
        );

        fireEvent.keyDown(valueInput(), { key: 'Escape' });
        openDrawer();

        expect(screen.queryByTestId('qb-rule-error')).toBeNull();
    });

    it('applies the draft and takes the drawer down with it [query-builder:I-14]', () => {
        const onApply = vi.fn();
        renderIntl(
            <QueryBuilderDrawer
                fields={FIELDS}
                value={group('root', [
                    rule('r1', 'title', OP.Contains, 'alpha')
                ])}
                onApply={onApply}
                trigger={<button type="button">Filters</button>}
            />
        );

        openDrawer();
        fireEvent.change(valueInput(), { target: { value: 'beta' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(onApply).toHaveBeenCalledTimes(1);
        expect(
            (onApply.mock.calls[0][0] as FilterGroup).children
        ).toMatchObject([{ value: 'beta' }]);
    });
});
