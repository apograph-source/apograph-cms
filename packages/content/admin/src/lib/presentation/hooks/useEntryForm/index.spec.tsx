import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import type { ContentTypeDetail } from '../../../domain/types/contentType';
import { useEntryForm } from './index';

/**
 * The **re-seed rule** alone (`ORT-230`) — not the whole hook.
 *
 * The editor's entry read is refetched in the background, so a changed
 * `initialValues` identity means one of two unrelated things: a different record
 * opened, or this record was read again and came back different because somebody
 * else saved it. The first must be adopted; the second must not be, while the
 * author has unsaved edits in the form. Getting that wrong is silent either way
 * — a wrong refusal shows the previous record, a wrong adoption destroys typing
 * — which is exactly the kind of rule that belongs in a unit test rather than in
 * a browser.
 */

const SCHEMA = {
    name: 'article',
    label: 'Articles',
    kind: 'collection',
    publishable: true,
    fields: [
        {
            name: 'title',
            type: 'text',
            required: false,
            validation: {},
            admin: { label: 'Title' }
        }
    ]
} as unknown as ContentTypeDetail;

function Wrapper({ children }: { children: ReactNode }) {
    return <IntlProvider locale="en">{children}</IntlProvider>;
}

type Props = { values: Record<string, unknown>; seedKey?: string };

function renderForm(initial: Props) {
    return renderHook(
        ({ values, seedKey }: Props) =>
            useEntryForm(SCHEMA, values, { seedKey }),
        { wrapper: Wrapper, initialProps: initial }
    );
}

const STORED = { title: 'Winter release notes' };
const THEIRS = { title: 'Winter release notes (rewritten by someone else)' };

describe('useEntryForm — re-seeding', () => {
    it('adopts new values while the form is untouched', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        rerender({ values: THEIRS, seedKey: 'edit:post-1' });

        // Nothing was typed, so there is nothing to protect and the fresh read
        // is simply better information.
        expect(result.current.values).toEqual(THEIRS);
        expect(result.current.seedRefused).toBe(false);
    });

    it('refuses new values over unsaved edits, and says so', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        act(() => result.current.setValue('title', 'My unsaved rewrite'));
        rerender({ values: THEIRS, seedKey: 'edit:post-1' });

        expect(result.current.values).toEqual({ title: 'My unsaved rewrite' });
        expect(result.current.seedRefused).toBe(true);
    });

    it('refuses on any edit, not only one that differs from the seed', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        // Typed back to what it already was: still someone working in this
        // form, and a needless refusal costs only the notice's discard button.
        act(() => result.current.setValue('title', STORED.title));
        rerender({ values: THEIRS, seedKey: 'edit:post-1' });

        expect(result.current.values).toEqual(STORED);
        expect(result.current.seedRefused).toBe(true);
    });

    it('adopts a different record even with unsaved edits', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        act(() => result.current.setValue('title', 'My unsaved rewrite'));
        // The editor is reused across the route move, and the guard has already
        // asked. A second record is not a conflict with the first.
        rerender({ values: THEIRS, seedKey: 'edit:post-2' });

        expect(result.current.values).toEqual(THEIRS);
        expect(result.current.seedRefused).toBe(false);
    });

    it('adopts the values it is holding when `acceptSeed` is called', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        act(() => result.current.setValue('title', 'My unsaved rewrite'));
        rerender({ values: THEIRS, seedKey: 'edit:post-1' });
        act(() => result.current.acceptSeed());

        expect(result.current.values).toEqual(THEIRS);
        expect(result.current.seedRefused).toBe(false);
    });

    it('adopts a seed that arrived *before* `acceptSeed` was called', () => {
        // The save path, exactly: `useSaveEntry` primes the read-one cache
        // inside `onSuccess`, so the new seed has already been refused by the
        // time the caller's `.then()` runs. Clearing the edit flag alone would
        // leave the form dirty forever, because there is no further identity
        // change left to react to.
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        act(() => result.current.setValue('title', 'Mine'));
        const saved = { title: 'Mine' };
        rerender({ values: saved, seedKey: 'edit:post-1' });
        expect(result.current.seedRefused).toBe(true);

        act(() => result.current.acceptSeed());

        expect(result.current.seedRefused).toBe(false);
        // And it is now seeded *from* that object: a further identity-equal
        // render must not re-refuse.
        rerender({ values: saved, seedKey: 'edit:post-1' });
        expect(result.current.seedRefused).toBe(false);
    });

    it('clears the reveal state on an adopted seed, and keeps it on a refused one', () => {
        const { result, rerender } = renderForm({
            values: STORED,
            seedKey: 'edit:post-1'
        });

        act(() =>
            result.current.setServerErrors([
                { field: 'title', message: 'is already taken' }
            ])
        );
        expect(result.current.errorFor('title')).toBe('is already taken');

        // Refused: the server's complaint is still about what is on screen.
        act(() => result.current.setValue('title', 'Mine'));
        rerender({ values: THEIRS, seedKey: 'edit:post-1' });
        act(() =>
            result.current.setServerErrors([
                { field: 'title', message: 'is already taken' }
            ])
        );
        expect(result.current.errorFor('title')).toBe('is already taken');

        // Adopted: the values it complained about are gone, so it goes too.
        act(() => result.current.acceptSeed());
        expect(result.current.errorFor('title')).toBeUndefined();
    });
});
