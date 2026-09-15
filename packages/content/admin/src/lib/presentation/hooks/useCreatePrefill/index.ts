import { useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The create-form prefill a slot hands the entry editor through
 * `location.state` — the i18n plugin's "create the {locale} translation" flow
 * passes the source record's values as `translateFrom`, and the locale they
 * were written in as `translateFromLocale`.
 */
export type CreatePrefill = {
    /** The source record's values, copied into the blank form's shared fields. */
    translateFrom?: Record<string, unknown>;
    /** The locale those copied values are actually written in (WCAG 3.1.2). */
    translateFromLocale?: string;
};

/** Nothing carried — one shared identity, so a stateless route never re-seeds. */
const NO_PREFILL: CreatePrefill = {};

function readPrefill(state: unknown): CreatePrefill {
    const carried = state as CreatePrefill | null;
    if (!carried?.translateFrom && !carried?.translateFromLocale) {
        return NO_PREFILL;
    }
    return {
        translateFrom: carried.translateFrom,
        translateFromLocale: carried.translateFromLocale
    };
}

/**
 * The prefill for the create form, **snapshotted once per create session**.
 *
 * A prefill is a *seed*, not live input: it says what a blank form starts from,
 * and the author's typing owns it from that point on. But the editor's tabs are
 * route segments, so moving between them is a navigation — and the history API
 * structured-clones what it is handed, so `location.state.translateFrom` comes
 * back as an **equal but differently identified** object every time. Read
 * straight off the location, that identity change re-keyed the memo that builds
 * the form's initial values, which re-seeded the form over whatever had been
 * typed into it (`ORT-228`). The plain create form has no state to re-read, so
 * it never showed the bug; the translation draft lost the title, slug and body
 * on the first tab move.
 *
 * `sessionKey` identifies *which* create this is — the editor is reused rather
 * than remounted as the route flips between `/new`, `/:id` and a fresh
 * `/new?locale=…`, so the key is what tells a genuinely new create (a different
 * target locale, a different record) from the same one seen again. While it
 * holds, so does the first prefill read under it, identity included.
 */
export function useCreatePrefill(sessionKey: string): CreatePrefill {
    const location = useLocation();
    const [seed, setSeed] = useState(() => ({
        key: sessionKey,
        prefill: readPrefill(location.state)
    }));
    // Adjust during render (the same idiom `useEntryForm` re-seeds with) rather
    // than in an effect: the values this feeds are read on this render, and an
    // effect would let one paint of the previous create's seed through.
    let current = seed;
    if (seed.key !== sessionKey) {
        current = { key: sessionKey, prefill: readPrefill(location.state) };
        setSeed(current);
    }
    return current.prefill;
}
