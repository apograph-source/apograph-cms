import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import type { EntryReview } from '../../../../domain/types';
import { ReviewActions } from './index';

vi.mock('../../../../application/hooks', () => ({
    useApprove: () => ({ mutate: vi.fn(), isPending: false })
}));

// The picker is a dialog of its own with its own spec; here it must only not
// render anything when asking is not offered.
vi.mock('../RequestReviewDialog', () => ({
    RequestReviewDialog: ({ open }: { open: boolean }) =>
        open ? <div role="dialog">picker</div> : null
}));

const SCOPE = {
    workspaceId: 'ws',
    typeName: 'article',
    entryId: 'entry-1'
} as const;

const review = (overrides: Partial<EntryReview> = {}): EntryReview => ({
    protected: true,
    required: 2,
    given: 1,
    stale: 0,
    blocked: true,
    bypassable: false,
    afterSave: { required: 2, given: 0, blocked: true, bypassable: false },
    headRevisionId: 'rev-7',
    headRevisionNumber: 7,
    callerWroteHead: false,
    callerApprovedHead: false,
    approvals: [],
    request: null,
    ...overrides
});

const draw = (
    state: Partial<EntryReview>,
    rights: { canApprove?: boolean; canRequest?: boolean } = {}
) =>
    render(
        <IntlProvider locale="en">
            <ReviewActions
                scope={SCOPE}
                review={review(state)}
                canApprove={rights.canApprove ?? true}
                canRequest={rights.canRequest ?? true}
            />
        </IntlProvider>
    );

const approveButton = () => screen.queryByRole('button', { name: /Approve/ });

/**
 * The controls under the reviewer list — the only component in this package
 * that had no spec, and the one holding three decisions nothing else pins: who
 * is offered Approve, who is told why they are not, and what the ask button is
 * called.
 */
describe('ReviewActions', () => {
    it('offers Approve to a reviewer who has not voted on this version', () => {
        draw({});

        expect(approveButton()).toBeTruthy();
    });

    /**
     * The four-eyes rule, as the person meeting it sees it: **a sentence, not a
     * disabled button**. A disabled control explains nothing to anybody and
     * nothing at all to a screen reader, and this is the one refusal in the
     * feature a person meets while looking at their own work.
     */
    it('tells the head’s author why Approve is not offered, in words', () => {
        draw({ callerWroteHead: true });

        expect(approveButton()).toBeNull();
        expect(
            screen.getByText(
                'You wrote this version, so somebody else has to approve it.'
            )
        ).toBeTruthy();
    });

    /** Already approved: the row carries the check, and a second press would do nothing. */
    it('drops Approve once the caller has approved this version', () => {
        draw({ callerApprovedHead: true });

        expect(approveButton()).toBeNull();
        expect(screen.queryByText(/You wrote this version/)).toBeNull();
    });

    /**
     * Without `content:approve` there is no button **and no sentence**: the
     * explanation is for somebody who could otherwise have approved, and
     * telling a viewer they wrote the version would answer a question they
     * never asked.
     */
    it('says nothing about approving to somebody who cannot approve', () => {
        draw({ callerWroteHead: true }, { canApprove: false });

        expect(approveButton()).toBeNull();
        expect(screen.queryByText(/You wrote this version/)).toBeNull();
    });

    it('names the ask "Request review" when nobody has asked yet', () => {
        draw({});

        expect(
            screen.getByRole('button', { name: /Request review/ })
        ).toBeTruthy();
    });

    /** The route replaces the reviewers on an open request, so the button says so. */
    it('names it "Change reviewers" when a request is open', () => {
        draw({
            request: {
                id: 'request-1',
                requestedBy: 'anna',
                reviewerIds: ['boris'],
                revisionId: 'rev-7',
                createdAt: '2026-09-09T09:00:00.000Z'
            }
        });

        expect(
            screen.getByRole('button', { name: /Change reviewers/ })
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Request review/ })).toBe(
            null
        );
    });

    it('offers no ask to somebody without content:update', () => {
        draw({}, { canRequest: false });

        expect(screen.queryByRole('button', { name: /Request/ })).toBeNull();
    });

    /**
     * Nothing to press and nothing to explain: the block renders **nothing**
     * rather than an empty row of padding under the reviewer list.
     */
    it('renders nothing at all when there is neither a vote nor an ask to make', () => {
        const { container } = draw(
            { callerApprovedHead: true },
            { canRequest: false }
        );

        expect(container.innerHTML).toBe('');
    });
});
