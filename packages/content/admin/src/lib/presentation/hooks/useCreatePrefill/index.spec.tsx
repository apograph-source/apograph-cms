import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useCreatePrefill } from './index';

/**
 * The create form's prefill is a **seed**: it says what a blank form starts
 * from, and the author owns it afterwards.
 *
 * The editor's tabs are route segments, so moving between them navigates — and
 * the history API structured-clones the state it carries, so the same prefill
 * comes back as a new object every time. What this pins is that the *identity*
 * survives that, because it is what the entry view's initial-values memo is
 * keyed on: a fresh identity re-seeded the form over what had been typed
 * (`ORT-228`).
 */

function wrapperFor(state: unknown) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <MemoryRouter
                initialEntries={[{ pathname: '/content/post/new', state }]}
            >
                {children}
            </MemoryRouter>
        );
    };
}

describe('useCreatePrefill', () => {
    it('reads the prefill a slot carried in the route state', () => {
        const { result } = renderHook(() => useCreatePrefill('create:fr'), {
            wrapper: wrapperFor({
                translateFrom: { author: 'Ada' },
                translateFromLocale: 'en'
            })
        });

        expect(result.current.translateFrom).toEqual({ author: 'Ada' });
        expect(result.current.translateFromLocale).toBe('en');
    });

    it('keeps the first identity while the create session holds', () => {
        const { result, rerender } = renderHook(
            () => useCreatePrefill('create:fr'),
            {
                wrapper: wrapperFor({ translateFrom: { author: 'Ada' } })
            }
        );
        const first = result.current;

        // A tab move: same create, same carried values, new object — which is
        // exactly what the history API hands back.
        rerender();

        expect(result.current).toBe(first);
    });

    it('re-reads when a different create session begins', () => {
        const { result, rerender } = renderHook(
            ({ key }: { key: string }) => useCreatePrefill(key),
            {
                wrapper: wrapperFor({ translateFrom: { author: 'Ada' } }),
                initialProps: { key: 'create:fr' }
            }
        );
        const first = result.current;

        rerender({ key: 'create:de' });

        expect(result.current).not.toBe(first);
        expect(result.current.translateFrom).toEqual({ author: 'Ada' });
    });

    it('is empty — and stably so — when the route carries nothing', () => {
        const { result, rerender } = renderHook(
            () => useCreatePrefill('create:'),
            { wrapper: wrapperFor(null) }
        );
        const first = result.current;

        rerender();

        expect(result.current.translateFrom).toBeUndefined();
        expect(result.current).toBe(first);
    });
});
