import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewerRowView } from '../../../../domain/reviewerRows';
import { ReviewerRow } from './index';

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({
        id: 'ws',
        members: [
            { id: 'anna', name: 'Anna Kovaleva', initials: 'AK', email: 'a@x' },
            { id: 'dmitry', name: 'Dmitry Moroz', initials: 'DM', email: 'd@x' }
        ]
    })
}));

const draw = (row: ReviewerRowView, currentUserId?: string) =>
    render(
        <IntlProvider locale="en">
            <ul>
                <ReviewerRow row={row} currentUserId={currentUserId} />
            </ul>
        </IntlProvider>
    );

describe('ReviewerRow', () => {
    /** The state is text; the green check beside it is decoration. */
    it('says an approval of the current version is approved', () => {
        const { container } = draw({
            userId: 'anna',
            state: 'approved',
            requested: true
        });

        expect(screen.getByText('Anna Kovaleva')).toBeTruthy();
        expect(screen.getByText('Approved')).toBeTruthy();
        expect(
            container.querySelector('[data-state="approved"] svg')
        ).toBeTruthy();
    });

    it('says an asked reviewer is pending, with the dot and no check', () => {
        const { container } = draw({
            userId: 'dmitry',
            state: 'pending',
            requested: true
        });

        expect(screen.getByText('Pending')).toBeTruthy();
        expect(
            container.querySelector('[data-state="pending"] svg')
        ).toBeNull();
    });

    /**
     * The line the whole panel exists for: if it ever stops being rendered, a
     * reader is shown "pending" for somebody who approved, with nothing saying
     * the entry moved on.
     */
    it('says in text that an approval a save left behind no longer counts', () => {
        draw({
            userId: 'dmitry',
            state: 'pending',
            requested: true,
            staleVersion: 4
        });

        const detail = screen.getByText(/approved version 4/);
        expect(detail.textContent).toContain('the entry has changed since');
        expect(detail.textContent).toContain('no longer counts');
    });

    it('does not claim staleness for somebody who has not approved at all', () => {
        draw({ userId: 'anna', state: 'pending', requested: true });

        expect(screen.queryByText(/no longer counts/)).toBeNull();
    });

    it('reads "You" for the signed-in person', () => {
        draw({ userId: 'anna', state: 'approved', requested: false }, 'anna');

        expect(screen.getByText('You')).toBeTruthy();
    });

    it('names somebody who has left as a former member', () => {
        draw({ userId: 'gone', state: 'approved', requested: false });

        expect(screen.getByText('A former member')).toBeTruthy();
    });
});
