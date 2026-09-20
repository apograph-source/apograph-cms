import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestReviewDialog } from './index';

const state = vi.hoisted(() => ({
    candidates: {
        isPending: false,
        isError: false,
        data: [] as { userId: string; email: string }[],
        refetch: vi.fn()
    },
    mutate: vi.fn()
}));

vi.mock('../../../../application/hooks', () => ({
    useReviewerCandidates: () => state.candidates,
    useRequestReview: () => ({ mutate: state.mutate, isPending: false })
}));

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({
        id: 'ws',
        members: [
            { id: 'anna', name: 'Anna Kovaleva', initials: 'AK', email: 'a@x' },
            { id: 'dmitry', name: 'Dmitry Moroz', initials: 'DM', email: 'd@x' }
        ]
    })
}));

// jsdom implements none of the browser APIs Radix's dialog reaches for.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
    })) as typeof window.matchMedia;
}
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
        observe() {
            return undefined;
        }
        unobserve() {
            return undefined;
        }
        disconnect() {
            return undefined;
        }
    } as unknown as typeof ResizeObserver;
}

const scope = {
    workspaceId: 'ws',
    typeName: 'article',
    entryId: 'e1',
    updatedAt: '2026-09-10T10:00:00.000Z'
};

function draw(currentReviewerIds: string[] = []) {
    return render(
        <IntlProvider locale="en">
            <RequestReviewDialog
                open
                onOpenChange={() => undefined}
                scope={scope}
                currentReviewerIds={currentReviewerIds}
            />
        </IntlProvider>
    );
}

beforeEach(() => {
    state.mutate.mockReset();
    state.candidates.isPending = false;
    state.candidates.isError = false;
    state.candidates.data = [
        { userId: 'anna', email: 'a@x' },
        { userId: 'dmitry', email: 'd@x' },
        { userId: 'newcomer', email: 'new@x' }
    ];
});

describe('RequestReviewDialog', () => {
    it('lists who can review by name, and by email when the roster does not know them', () => {
        draw();

        expect(
            screen.getByRole('checkbox', { name: /Anna Kovaleva/ })
        ).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: /new@x/ })).toBeTruthy();
    });

    /** No note: the only thing a request carries is who is asked. */
    it('offers nowhere to write a message', () => {
        draw();

        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('refuses to ask nobody, and says why', () => {
        draw();

        fireEvent.click(screen.getByRole('button', { name: 'Request' }));

        expect(state.mutate).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toMatch(
            /at least one reviewer/i
        );
    });

    it('asks the people picked, in the order they were picked', () => {
        draw();

        fireEvent.click(screen.getByRole('checkbox', { name: /Dmitry Moroz/ }));
        fireEvent.click(
            screen.getByRole('checkbox', { name: /Anna Kovaleva/ })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Request' }));

        expect(state.mutate).toHaveBeenCalledWith(
            {
                typeName: 'article',
                entryId: 'e1',
                reviewerIds: ['dmitry', 'anna']
            },
            expect.anything()
        );
    });

    /** On an open request it starts from who is already asked — change, not redo. */
    it('starts from the reviewers already asked', () => {
        draw(['anna']);

        expect(
            screen
                .getByRole('checkbox', { name: /Anna Kovaleva/ })
                .getAttribute('aria-checked')
        ).toBe('true');
    });

    it('says so when nobody else can approve', () => {
        state.candidates.data = [];
        draw();

        expect(screen.getByText(/nobody else in this workspace/i)).toBeTruthy();
    });
});
