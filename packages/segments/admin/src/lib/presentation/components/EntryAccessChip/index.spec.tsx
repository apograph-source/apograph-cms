// Read off the DOM rather than through `jest-dom`: this package registers no
// matcher setup, and adding one for four assertions is a setup file to keep.
import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntrySlotContext } from '@orthacms/content-admin';
import { useEntryAccess, useSegments } from '../../../application/hooks';
import { EntryAccessChip } from './index';

vi.mock('../../../application/hooks', () => ({
    useSegments: vi.fn(),
    useEntryAccess: vi.fn()
}));

const segments = vi.mocked(useSegments);
const access = vi.mocked(useEntryAccess);

/** What the directory query answers, reduced to what the chip reads. */
function directory(total: number) {
    return { data: total ? { total } : { total: 0 } } as ReturnType<
        typeof useSegments
    >;
}

/** What the entry-access query answers. */
function stored(
    value: { allow: string[]; deny: string[] } | undefined,
    isPending = false
) {
    return { data: value, isPending } as ReturnType<typeof useEntryAccess>;
}

const CONTEXT = {
    workspaceId: 'w1',
    entry: { id: 'e1', updatedAt: 'v1' },
    mode: 'collection',
    typePath: '/workspaces/w1/content/article'
} as unknown as EntrySlotContext;

function draw(element: ReactElement) {
    return render(
        <IntlProvider locale="en">
            <MemoryRouter>{element}</MemoryRouter>
        </IntlProvider>
    );
}

describe('EntryAccessChip', () => {
    beforeEach(() => vi.clearAllMocks());

    /**
     * With no audience created the feature is inert server-side — the read scope
     * emits no predicate and a public read is byte-for-byte what it was before
     * the plugin existed. A badge saying "Everyone" beside the title would be a
     * claim about a system that is not running, and it would appear on every
     * entry in every installation that merely has the plugin registered.
     */
    it('renders nothing while the workspace has no audiences [segments:I-30]', () => {
        segments.mockReturnValue(directory(0));
        access.mockReturnValue(stored({ allow: [], deny: [] }));

        const { container } = draw(<EntryAccessChip {...CONTEXT} />);

        expect(container.innerHTML).toBe('');
    });

    /**
     * The pair that stops the case above passing for the trivial reason. With
     * one audience in the workspace the same props draw a chip, so "nothing" is
     * the catalogue's doing rather than the component's.
     */
    it('reads an entry with two empty lists as everyone', () => {
        segments.mockReturnValue(directory(1));
        access.mockReturnValue(stored({ allow: [], deny: [] }));

        draw(<EntryAccessChip {...CONTEXT} />);

        expect(screen.getByRole('link').textContent).toContain('Everyone');
    });

    it('reads an entry with an allow list as restricted', () => {
        segments.mockReturnValue(directory(1));
        access.mockReturnValue(stored({ allow: ['s1'], deny: [] }));

        draw(<EntryAccessChip {...CONTEXT} />);

        const link = screen.getByRole('link');
        expect(link.textContent).toContain('Restricted');
        // Straight to the tab that holds the whole answer, nested under the row
        // on a collection.
        expect(link.getAttribute('href')).toBe(
            '/workspaces/w1/content/article/e1/access'
        );
    });

    it('renders nothing before there is an entry to describe [segments:I-30]', () => {
        // The create form, where there is no row and therefore nothing true to
        // say about who can read it.
        segments.mockReturnValue(directory(1));
        access.mockReturnValue(stored(undefined));

        const { container } = draw(
            <EntryAccessChip {...CONTEXT} entry={undefined} />
        );

        expect(container.innerHTML).toBe('');
    });
});
