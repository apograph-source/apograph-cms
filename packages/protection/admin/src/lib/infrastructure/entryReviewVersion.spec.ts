import {
    entryReviewVersion,
    type CachedEntryReview
} from './entryReviewVersion';
import { entryReviewKey, entryReviewPrefix } from './protectionKeys';
import type { EntryReview } from '../domain/types';

const WS = 'ws-1';
const TYPE = 'blog_post';
const ENTRY = 'entry-1';

const V1 = '2026-01-01T00:00:00.000Z';
const V2 = '2026-01-02T00:00:00.000Z';
const V3 = '2026-01-03T00:00:00.000Z';

const review = (over: Partial<EntryReview> = {}): EntryReview => ({
    protected: true,
    required: 2,
    given: 0,
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
    ...over
});

/** An unprotected answer, the shape the server returns with no rule in force. */
const unprotected = (): EntryReview =>
    review({
        protected: false,
        required: 0,
        blocked: false,
        afterSave: { required: 0, given: 0, blocked: false, bypassable: false }
    });

/** One cache entry, keyed the way `useEntryReview` keys it. */
const cached = (
    version: string,
    data: EntryReview | undefined
): CachedEntryReview => [entryReviewKey(WS, TYPE, ENTRY, version), data];

describe('entryReviewVersion', () => {
    it('is the entry’s updatedAt when nothing is cached yet', () => {
        expect(entryReviewVersion([], V2)).toBe(V2);
    });

    it('is the new updatedAt when the cached answer says protected', () => {
        // The whole point of the key: a save mints a new one, so the panel
        // cannot keep showing the previous version's tally.
        expect(entryReviewVersion([cached(V1, review())], V2)).toBe(V2);
    });

    it('reuses the token of an unprotected answer, so a save mints no new key', () => {
        // With no rule the editor must behave as it does with the plugin
        // uninstalled (protection:I-03 / I-04) — no new key, so no request.
        expect(entryReviewVersion([cached(V1, unprotected())], V2)).toBe(V1);
    });

    it('keeps reusing the same token across further saves', () => {
        const held = entryReviewVersion([cached(V1, unprotected())], V2);
        expect(entryReviewVersion([cached(held, unprotected())], V3)).toBe(V1);
    });

    it('ignores a key whose query has never resolved', () => {
        expect(entryReviewVersion([cached(V1, undefined)], V2)).toBe(V2);
    });

    it('takes the newest unprotected token, whatever order the cache is in', () => {
        const entries = [cached(V1, unprotected()), cached(V2, unprotected())];
        expect(entryReviewVersion(entries, V3)).toBe(V2);
        expect(entryReviewVersion([...entries].reverse(), V3)).toBe(V2);
    });

    it('mints a new key across a run of protected versions', () => {
        // Every save of a protected entry has to be able to ask again: which
        // approvals count is exactly what the save changed.
        expect(
            entryReviewVersion([cached(V1, review()), cached(V2, review())], V3)
        ).toBe(V3);
    });

    it('holds the unprotected token even with an older protected answer cached', () => {
        // The rule was deleted, and the save after that learnt so. The newest
        // answer is the unprotected one, and it is the one that decides — the
        // stale protected answer under an older version does not drag the key
        // forward into a request there is nothing to ask about.
        expect(
            entryReviewVersion(
                [cached(V1, review()), cached(V2, unprotected())],
                V3
            )
        ).toBe(V2);
    });

    it('ignores a key whose last component is not a version token', () => {
        // Defensive: the cache is typed `unknown[]`, and a token that is not a
        // string is not one this module minted.
        expect(
            entryReviewVersion(
                [[[...entryReviewPrefix(WS, TYPE, ENTRY), 42], unprotected()]],
                V2
            )
        ).toBe(V2);
    });
});
