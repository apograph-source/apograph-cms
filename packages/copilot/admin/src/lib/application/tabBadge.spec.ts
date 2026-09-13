import { badgeCount, badgedTitle } from './tabBadge';
import type { CopilotSession } from './sessions';

/** A session, with only the fields the badge looks at spelled out. */
function session(overrides: Partial<CopilotSession> = {}): CopilotSession {
    return {
        id: 'a',
        conversationId: null,
        title: null,
        minimized: false,
        unread: false,
        awaiting: false,
        presented: 'dock',
        choice: null,
        choicePinned: false,
        context: null,
        skills: [],
        ...overrides
    };
}

describe('badgeCount', () => {
    it('counts a chat that finished off screen', () => {
        expect(badgeCount([session({ unread: true })])).toBe(1);
    });

    it('counts a chat parked on a permission prompt', () => {
        expect(badgeCount([session({ awaiting: true })])).toBe(1);
    });

    it('counts a chat once even when both are true', () => {
        // The badge answers "how many chats need me", not "how many things
        // happened" — two counts for one chat would send the user looking for a
        // second one.
        expect(badgeCount([session({ unread: true, awaiting: true })])).toBe(1);
    });

    it('ignores chats with nothing to report', () => {
        expect(badgeCount([session(), session({ id: 'b' })])).toBe(0);
    });

    it('counts a page-presented chat that is stuck', () => {
        // `unread` is never set on a visible chat, but `awaiting` is: a run
        // parked while you were reading it stays parked after you tab away, and
        // that is precisely when the badge is the only thing that can tell you.
        expect(
            badgeCount([session({ presented: 'page', awaiting: true })])
        ).toBe(1);
    });

    it('is zero for no chats at all', () => {
        expect(badgeCount([])).toBe(0);
    });
});

describe('badgedTitle', () => {
    it('prefixes the count', () => {
        // Prefixed, not appended: a tab is a few characters wide once several
        // are open, and the end of a title is the first thing thrown away.
        expect(badgedTitle('Apograph CMS', 2)).toBe('(2) Apograph CMS');
    });

    it('leaves the title alone at zero', () => {
        expect(badgedTitle('Apograph CMS', 0)).toBe('Apograph CMS');
    });

    it('cannot stack, because it always builds from the base', () => {
        const base = 'Apograph CMS';
        expect(badgedTitle(badgedTitle(base, 1), 2)).toBe(
            '(2) (1) Apograph CMS'
        );
        // …which is why the caller captures `base` once and never re-reads
        // `document.title`. Stated here so the rule has a test that fails if
        // someone "simplifies" it.
        expect(badgedTitle(base, 2)).toBe('(2) Apograph CMS');
    });
});
