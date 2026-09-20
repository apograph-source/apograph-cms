import type { CopilotSession } from './sessions';

/**
 * How many chats want the user back.
 *
 * `awaiting` — parked on a permission prompt — counts even while the chat is on
 * screen, because it is *stuck*: nothing more happens until someone answers, and
 * a user who has tabbed away has no other way to learn that. `unread` is already
 * only ever set on a chat that is off screen (see `sessionsReducer`), so it
 * needs no second check here.
 *
 * A chat is counted **once** even when both are true, because the badge answers
 * "how many chats need me", not "how many things happened".
 */
export function badgeCount(sessions: readonly CopilotSession[]): number {
    return sessions.filter((session) => session.unread || session.awaiting)
        .length;
}

/**
 * The document title for a given count.
 *
 * Prefixed rather than appended: a tab is a few characters wide when several are
 * open, and the end of the title is the first thing a browser throws away.
 *
 * `base` is the title with no badge on it — the caller captures that once, at
 * mount, so repeated updates cannot stack `(1) (2) Ortha CMS`.
 */
export function badgedTitle(base: string, count: number): string {
    return count > 0 ? `(${count}) ${base}` : base;
}
