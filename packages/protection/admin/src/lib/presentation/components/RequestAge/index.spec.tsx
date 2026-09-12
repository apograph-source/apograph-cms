import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntlProvider } from 'react-intl';
import { RequestAge, ageInDays } from './index';

/**
 * The cut this component used to hold as a constant of its own. It is the
 * server's now and arrives with the queue, so the tests state it as the input
 * it is — and a server that moved the threshold moves these rows with it
 * instead of leaving the page and the Insights card disagreeing.
 */
const OVERDUE_AFTER_DAYS = 3;

/** `iso` for a request opened `days` ago. */
const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();

const show = (createdAt: string) =>
    render(
        <IntlProvider locale="en">
            <RequestAge
                createdAt={createdAt}
                overdueAfterDays={OVERDUE_AFTER_DAYS}
            />
        </IntlProvider>
    );

describe('ageInDays', () => {
    it('floors to whole days', () => {
        expect(ageInDays(daysAgo(2.9))).toBe(2);
    });

    it('reads a future timestamp as zero rather than negative', () => {
        expect(ageInDays(new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });

    it('reads an unparsable timestamp as zero rather than NaN', () => {
        expect(ageInDays('not a date')).toBe(0);
    });
});

describe('RequestAge', () => {
    it('says how long an ask has waited', () => {
        show(daysAgo(2));

        expect(screen.getByText(/2 days waiting/)).toBeTruthy();
    });

    it('falls back to hours under a day', () => {
        show(new Date(Date.now() - 5 * 3_600_000).toISOString());

        expect(screen.getByText(/5 hours waiting/)).toBeTruthy();
    });

    /**
     * The check that matters. An overdue request is *coloured* — and colour is
     * not information: a greyscale screen, a colour-blind reader and a screen
     * reader all have to get the same fact, so the word has to be in the text.
     */
    it('says "overdue" in words, not only in colour', () => {
        show(daysAgo(OVERDUE_AFTER_DAYS));

        expect(screen.getByText(/overdue/)).toBeTruthy();
    });

    it('does not call a fresh request overdue', () => {
        show(daysAgo(OVERDUE_AFTER_DAYS - 1));

        expect(screen.queryByText(/overdue/)).toBeNull();
    });

    it('carries the exact moment on the element, not just the rounded phrase', () => {
        const createdAt = daysAgo(2);
        const { container } = show(createdAt);

        expect(container.querySelector('time')?.getAttribute('datetime')).toBe(
            createdAt
        );
    });
});
