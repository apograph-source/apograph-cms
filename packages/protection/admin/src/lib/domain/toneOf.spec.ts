import { describe, expect, it } from 'vitest';
import { approvalBlockedReason, toneOf, type EntryReview } from './types';

const review = (given: number, required: number): EntryReview => ({
    protected: true,
    required,
    given,
    stale: 0,
    blocked: given < required,
    bypassable: false,
    afterSave: { required, given: 0, blocked: required > 0, bypassable: false },
    headRevisionId: 'rev-7',
    headRevisionNumber: 7,
    callerWroteHead: false,
    callerApprovedHead: false,
    approvals: [],
    request: null
});

/**
 * The three-way split behind every tone in this plugin — the header chip, the
 * rail's count, the records cell. It is one function so those three cannot
 * disagree, and it had no test at all: `given === 0` reading as "partial"
 * would have turned an untouched entry amber everywhere at once.
 */
describe('toneOf', () => {
    it('is satisfied once the count reaches what the rule asks', () => {
        expect(toneOf(review(2, 2))).toBe('satisfied');
    });

    /** Above the bar is still satisfied — a third approval is not a new state. */
    it('stays satisfied past the requirement', () => {
        expect(toneOf(review(3, 2))).toBe('satisfied');
    });

    it('is partial while somebody has approved but not enough have', () => {
        expect(toneOf(review(1, 2))).toBe('partial');
    });

    /** Nobody has looked: the strongest of the three, and the default state. */
    it('is blocked when nobody has approved', () => {
        expect(toneOf(review(0, 2))).toBe('blocked');
    });

    /**
     * A rule asking for nothing cannot exist — the API refuses it and a check
     * constraint is the floor — but the function is total, and "zero of zero"
     * is satisfied rather than blocked, which is what an unprotected type
     * reports before anybody protects it.
     */
    it('treats zero required as satisfied, not blocked', () => {
        expect(toneOf(review(0, 0))).toBe('satisfied');
    });
});

/**
 * Why the Approve button is absent, as a value rather than as three booleans
 * spelled out at the call site.
 */
describe('approvalBlockedReason', () => {
    it('names the missing permission first', () => {
        expect(approvalBlockedReason(review(0, 2), false)).toBe(
            'no-permission'
        );
    });

    it('names the four-eyes rule for the head’s author', () => {
        expect(
            approvalBlockedReason(
                { ...review(0, 2), callerWroteHead: true },
                true
            )
        ).toBe('wrote-head');
    });

    /**
     * The permission is asked first on purpose: somebody who cannot approve at
     * all is not told they wrote the version, because that answers a question
     * they were never in a position to ask.
     */
    it('says nothing about the version to somebody who cannot approve', () => {
        expect(
            approvalBlockedReason(
                { ...review(0, 2), callerWroteHead: true },
                false
            )
        ).toBe('no-permission');
    });

    it('is null when nothing is in the way', () => {
        expect(approvalBlockedReason(review(0, 2), true)).toBeNull();
    });
});
