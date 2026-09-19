import { useCallback, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import type {
    ContentTypeDetail,
    EntryValidationIssue
} from '../../../domain/types/contentType';
import { validateEntryValues } from '../../entryValidation';

/** Controlled form state for a content entry, plus its operations. */
export type EntryFormState = {
    /** Current values, keyed by field name. */
    values: Record<string, unknown>;
    /**
     * The **strict** validation errors (required enforced), keyed by field name.
     * Exposed so callers (e.g. the editor's publish gate) reuse this single
     * computation rather than re-running validation over the same values.
     */
    errors: Record<string, string>;
    /**
     * The **relaxed** validation errors (required not enforced, format only) —
     * what {@link submitDraft} gates on. Exposed beside {@link errors} so a
     * caller can tell, in the same tick a submit was refused, which fields
     * blocked it: both maps are derived from the current values, while
     * {@link errorFor} only reflects the reveal state of the *previous* render.
     */
    draftErrors: Record<string, string>;
    /** The error to show for a field (only once touched or after a submit). */
    errorFor: (name: string) => string | undefined;
    /** Set one field's value. */
    setValue: (name: string, value: unknown) => void;
    /** Mark a field touched (typically on blur) so its error can show. */
    touch: (name: string) => void;
    /**
     * Validate **strictly** (required enforced) and, if clean, hand the values
     * to `onValid`; otherwise reveal every field's error. For publish / saving an
     * always-live type. Returns whether it submitted.
     */
    submit: (onValid: (values: Record<string, unknown>) => void) => boolean;
    /**
     * Validate with **required relaxed** (format only) and, if clean, hand the
     * values to `onValid`; otherwise reveal every field's format error. For
     * saving a publishable **draft** — incomplete is fine, but a malformed value
     * is still gated before it reaches the server. Returns whether it submitted.
     */
    submitDraft: (
        onValid: (values: Record<string, unknown>) => void
    ) => boolean;
    /**
     * Apply server-side validation issues (a 422 from the write API) onto the
     * form so they show inline on the right fields, even when client validation
     * thought the form was clean. Each clears as soon as its field is edited.
     */
    setServerErrors: (issues: EntryValidationIssue[]) => void;
    /**
     * Whether a re-seed was **refused** because the author had already edited
     * this form — i.e. the record changed underneath them (a background refetch
     * of a row somebody else saved) and the incoming values were not applied.
     *
     * It is an event to report, not a validation result: nothing here gates the
     * save, and the values on screen are still the author's
     * (`content:I-38`/`I-40`). The editor renders a notice offering
     * {@link acceptSeed}; stays true until the form adopts a seed again.
     */
    seedRefused: boolean;
    /**
     * Discard the author's edits and adopt the **current** `initialValues` on
     * the next render — the way out of {@link seedRefused}, and the way a
     * successful save re-arms seeding (see the hook's note).
     */
    acceptSeed: () => void;
};

/**
 * Parked in the seed slot by {@link EntryFormState.acceptSeed} to mean "adopt
 * whatever `initialValues` is on the next render".
 *
 * Its identity can never equal an `initialValues` object, so the re-seed branch
 * below fires exactly once and reads the values the *caller* holds at that
 * moment. Clearing the edit flag alone would not do it: the refused seed has
 * already arrived, so there is no further identity change to react to. The
 * latch is read **during render**, the same idiom `useCreatePrefill` uses, so
 * no paint of the refused state slips through an effect.
 */
const ADOPT_NEXT_RENDER: Record<string, unknown> = {};

/**
 * Owns a content entry form's state: values seeded from `initialValues`, live
 * validation against the schema (mirroring the server rules via
 * {@link validateEntryValues}), and touched/submitted tracking so an error only
 * appears once the user has interacted with a field or tried to save.
 *
 * **Seeding, and when it is refused (`ORT-230`).** The form re-seeds on
 * `initialValues` **identity**, which is how a freshly read record reaches the
 * screen. But the entry read is refetched in the background — on window focus,
 * on reconnect, on any remount past its `staleTime` — so that identity also
 * changes when *somebody else* saved the record while the author was typing.
 * Re-seeding there replaced the author's unsaved work with the colleague's,
 * silently: nothing navigated, so the unsaved-changes guard never fired, and it
 * could not have — the re-seed sets `values` to the very object dirtiness is
 * measured against, so it **disarms** the guard on its way past.
 *
 * So a re-seed is refused while the form holds edits, and the refusal is
 * reported ({@link EntryFormState.seedRefused}) rather than swallowed: a silent
 * refusal is the same class of bug as the silent overwrite. "Edits" means any
 * {@link EntryFormState.setValue} — not "differs from the seed" — because with
 * the notice on screen a needless refusal costs a click and a wrong adoption
 * costs the author their work.
 *
 * Two escapes, and both are needed:
 *
 * - **`seedKey`** identifies *which* record (or create session) the form is
 *   for. The editor is reused rather than remounted as the route moves between
 *   records, so a changed key is a different form, never a conflict: the
 *   incoming values are adopted whatever this one holds. Without it, discarding
 *   at the unsaved-changes
 *   prompt and opening a cached second record would leave the first one's
 *   values on screen under a conflict notice.
 * - **{@link EntryFormState.acceptSeed}** adopts on demand. The editor's save
 *   path calls it, and must: `useSaveEntry` primes the read-one cache with the
 *   write response inside `onSuccess`, which runs **before** the caller's
 *   `.then()` — so by the time a save could clear the edit flag, its own new
 *   seed has already arrived and been refused. Clearing the flag is therefore
 *   not enough; `acceptSeed` latches an adoption for the next render.
 */
export function useEntryForm(
    schema: ContentTypeDetail,
    initialValues: Record<string, unknown>,
    options: {
        ignoreFields?: ReadonlySet<string>;
        /**
         * Which record (or create session) these values belong to. A change
         * here re-seeds unconditionally — see the hook's note. Omitted, every
         * identity change is treated as the same form being re-read.
         */
        seedKey?: string;
    } = {}
): EntryFormState {
    const intl = useIntl();
    const { ignoreFields, seedKey } = options;
    const [values, setValues] = useState(initialValues);
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [submitted, setSubmitted] = useState(false);
    // A draft submit reveals format errors across all fields without nagging
    // about empty required ones (distinct from the strict `submitted`).
    const [draftSubmitted, setDraftSubmitted] = useState(false);
    // Field-keyed messages the server rejected the last save with.
    const [serverErrors, setServerErrorState] = useState<
        Record<string, string>
    >({});
    // Whether the author has typed into this form since it was last seeded.
    const [edited, setEdited] = useState(false);
    // Whether an incoming seed was turned away because of that.
    const [seedRefused, setSeedRefused] = useState(false);

    // What this form was last seeded from, and for which record.
    const [seed, setSeed] = useState<{
        key: string | undefined;
        values: Record<string, unknown>;
    }>(() => ({ key: seedKey, values: initialValues }));

    /** Take the incoming values wholesale — a fresh form for a fresh read. */
    const adopt = () => {
        setSeed({ key: seedKey, values: initialValues });
        setValues(initialValues);
        setTouched(new Set());
        setSubmitted(false);
        setDraftSubmitted(false);
        setServerErrorState({});
        setEdited(false);
        setSeedRefused(false);
    };

    // Adjusted **during render**, not in an effect: the values below are read
    // on this render, and an effect would let one paint of the previous seed
    // through.
    if (seed.key !== seedKey) {
        // A different record entirely. Nothing about this is a conflict, and
        // the form must follow the route.
        adopt();
    } else if (seed.values !== initialValues) {
        // The same record, read again with a different answer.
        if (edited) {
            if (!seedRefused) setSeedRefused(true);
        } else {
            adopt();
        }
    }

    // Full errors (required enforced) gate a strict submit and show after one.
    const errors = useMemo(
        () => validateEntryValues(schema, values, intl, { ignoreFields }),
        [schema, values, intl, ignoreFields]
    );
    // Draft errors (required relaxed) are what a touched field shows live, so
    // drafting never nags about empty required fields — only their format.
    const draftErrors = useMemo(
        () =>
            validateEntryValues(schema, values, intl, {
                requireRequired: false,
                ignoreFields
            }),
        [schema, values, intl, ignoreFields]
    );

    const setValue = useCallback((name: string, value: unknown) => {
        // Any keystroke arms the refusal above — deliberately not "differs from
        // the seed": typing a value back to what it was still means the author
        // is working here, and the cost of being wrong is not symmetric.
        setEdited(true);
        setValues((current) => ({ ...current, [name]: value }));
        // Editing a field clears the stale server error it carried — the next
        // save re-checks it.
        setServerErrorState((current) => {
            if (!(name in current)) return current;
            const next = { ...current };
            delete next[name];
            return next;
        });
    }, []);

    const setServerErrors = useCallback((issues: EntryValidationIssue[]) => {
        setSubmitted(true);
        setServerErrorState(
            issues.reduce<Record<string, string>>((map, issue) => {
                // First message per field wins (matches the inline single-error UI).
                if (!(issue.field in map)) map[issue.field] = issue.message;
                return map;
            }, {})
        );
    }, []);

    const acceptSeed = useCallback(() => {
        setEdited(false);
        // Park the latch rather than adopting here: the caller may be a promise
        // continuation, and the values to adopt are whatever the *next* render
        // is handed — which after a save is the record the server just wrote.
        setSeed((current) => ({ ...current, values: ADOPT_NEXT_RENDER }));
    }, []);

    const touch = useCallback((name: string) => {
        setTouched((current) =>
            current.has(name) ? current : new Set(current).add(name)
        );
    }, []);

    const errorFor = useCallback(
        (name: string) =>
            // A server-rejected field wins; then a strict submit reveals full
            // errors (incl. required); a draft submit (or a touched field)
            // reveals only the draft (format) error, so required never nags
            // while editing or saving a draft.
            serverErrors[name] ??
            (submitted
                ? errors[name]
                : draftSubmitted || touched.has(name)
                  ? draftErrors[name]
                  : undefined),
        [serverErrors, submitted, draftSubmitted, touched, errors, draftErrors]
    );

    const submit = useCallback(
        (onValid: (values: Record<string, unknown>) => void) => {
            setSubmitted(true);
            if (Object.keys(errors).length > 0) return false;
            onValid(values);
            return true;
        },
        [errors, values]
    );

    const submitDraft = useCallback(
        (onValid: (values: Record<string, unknown>) => void) => {
            setDraftSubmitted(true);
            if (Object.keys(draftErrors).length > 0) return false;
            onValid(values);
            return true;
        },
        [draftErrors, values]
    );

    return {
        values,
        errors,
        draftErrors,
        errorFor,
        setValue,
        touch,
        submit,
        submitDraft,
        setServerErrors,
        seedRefused,
        acceptSeed
    };
}
