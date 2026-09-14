import {
    DEFAULT_MAX_ATTEMPTS,
    RETRY_SCHEDULE_MS,
    isExhausted,
    nextAttemptDelayMs
} from './retry-policy';

describe('nextAttemptDelayMs', () => {
    it('follows the schedule, attempt by attempt', () => {
        // random() === 0.5 cancels the jitter, so the base shows through.
        const noJitter = () => 0.5;
        for (const [index, base] of RETRY_SCHEDULE_MS.entries()) {
            expect(nextAttemptDelayMs(index + 1, noJitter)).toBe(base);
        }
    });

    it('holds at the last step rather than growing without bound', () => {
        const last = RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1];
        expect(nextAttemptDelayMs(99, () => 0.5)).toBe(last);
    });

    it('treats a zeroth attempt as the first', () => {
        expect(nextAttemptDelayMs(0, () => 0.5)).toBe(RETRY_SCHEDULE_MS[0]);
    });

    it('spreads ±20 % so a backlog does not come back as one burst', () => {
        const base = RETRY_SCHEDULE_MS[0];
        expect(nextAttemptDelayMs(1, () => 0)).toBe(base * 0.8);
        expect(nextAttemptDelayMs(1, () => 1)).toBe(base * 1.2);
    });
});

describe('isExhausted', () => {
    it('gives a message the configured number of attempts', () => {
        expect(isExhausted(DEFAULT_MAX_ATTEMPTS - 1)).toBe(false);
        expect(isExhausted(DEFAULT_MAX_ATTEMPTS)).toBe(true);
    });

    it('honours a deployment that shortened the budget', () => {
        expect(isExhausted(2, 3)).toBe(false);
        expect(isExhausted(3, 3)).toBe(true);
    });
});
