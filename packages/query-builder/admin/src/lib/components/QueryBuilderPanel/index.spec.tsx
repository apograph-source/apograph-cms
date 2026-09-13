import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OP, type FilterGroup } from '../../types/filter-tree.type';
import { FIELDS, group, renderIntl, rule } from '../__test__/harness';
import { QueryBuilderPanel } from '.';

/**
 * The staged draft's lifecycle. The panel is not a controlled component all the
 * way down — it holds the edits until Apply — so the one thing that can go
 * wrong invisibly is the draft outliving the surface it was typed into: reopen
 * the panel and edit yesterday's abandoned rule while the table shows today's
 * filter.
 */

/** The panel as a list page mounts it: the consumer owns `open` and the value. */
function Host({
    initial,
    onApply = vi.fn()
}: {
    initial: FilterGroup | null;
    onApply?: (next: FilterGroup | null) => void;
}) {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState<FilterGroup | null>(initial);
    return (
        <>
            <button id="toggle" onClick={() => setOpen((o) => !o)}>
                Filters
            </button>
            <QueryBuilderPanel
                open={open}
                onOpenChange={setOpen}
                fields={FIELDS}
                value={value}
                labelledBy="toggle"
                onApply={(next) => {
                    setValue(next);
                    onApply(next);
                }}
            />
        </>
    );
}

const valueInput = () =>
    screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;
const toggle = () => screen.getByRole('button', { name: 'Filters' });

describe('QueryBuilderPanel', () => {
    it('discards an un-applied edit when it is closed and reopened [query-builder:I-14]', () => {
        renderIntl(
            <Host
                initial={group('root', [
                    rule('r1', 'title', OP.Contains, 'alpha')
                ])}
            />
        );

        expect(valueInput().value).toBe('alpha');
        fireEvent.change(valueInput(), { target: { value: 'beta' } });
        expect(valueInput().value).toBe('beta');

        // Closing without Apply. The draft is the panel's own state and the
        // section stays in the DOM (it is animated shut and made `inert`), so
        // nothing unmounts it — the resync on open is the only thing that puts
        // the user back on the filter the table is actually showing.
        fireEvent.click(toggle());
        fireEvent.click(toggle());

        expect(valueInput().value).toBe('alpha');
    });

    it('re-reads the applied filter, not the last thing it showed [query-builder:I-14]', () => {
        const onApply = vi.fn();
        renderIntl(
            <Host
                initial={group('root', [
                    rule('r1', 'title', OP.Contains, 'alpha')
                ])}
                onApply={onApply}
            />
        );

        fireEvent.change(valueInput(), { target: { value: 'gamma' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        // Applied, so this *is* the current filter; the draft must survive the
        // trip rather than snap back to what the panel opened on.
        expect(onApply).toHaveBeenCalledTimes(1);

        fireEvent.click(toggle());
        fireEvent.click(toggle());

        expect(valueInput().value).toBe('gamma');
    });

    it('clears the previous attempt’s error state on reopening [query-builder:I-14]', () => {
        renderIntl(
            <Host
                initial={group('root', [rule('r1', 'title', OP.Contains, '')])}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(screen.getByTestId('qb-rule-error').textContent).toContain(
            'Value required'
        );

        fireEvent.click(toggle());
        fireEvent.click(toggle());

        // The rule is still incomplete — it is the same rule. What must not
        // survive is the *shaming*: a reopened panel is a fresh draft, and the
        // user has not pressed Apply on it.
        expect(screen.queryByTestId('qb-rule-error')).toBeNull();
    });
});
