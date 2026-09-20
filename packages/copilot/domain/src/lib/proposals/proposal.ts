/**
 * Where a proposal's change lands. Opaque to the copilot and meaningful only to
 * the applier that declared the matching {@link ProposalDraft.kind} — content
 * puts a type name and entry id here, media an asset id.
 *
 * Deliberately untyped beyond "a JSON object": the copilot must not learn the
 * shape of every plugin's addressing, or it becomes the thing that has to
 * change whenever one of them does.
 */
export type ProposalTarget = Readonly<Record<string, unknown>>;

/** One field's before/after, for the diff a human reviews. */
export interface ProposalChange {
    /** The field's name, as the content type declares it. */
    field: string;
    /** A human label for the field, when the schema has one. */
    label?: string;
    /** The value today. Absent on a create — there is nothing to replace. */
    before?: unknown;
    /** The value the proposal would write. */
    after: unknown;
}

/**
 * What a `propose` tool returns: a change described well enough for a human to
 * decide on, and for an applier to carry out.
 *
 * **The tool does not write it.** A propose tool computes the change and hands
 * it back; the run engine persists it as a `copilot_proposals` row and then
 * applies it. That split survived
 * [ADR-0009](../../../../../docs/adr/0009-copilot-applies-directly.md) removing
 * the human step, and is now the *only* thing carrying ADR-0005 §5's
 * "undoable, never invisible" — the row is the receipt, written before the
 * write, in one place instead of once per binder. Keep the split even though
 * nothing waits on it any more: a binder that wrote directly would be a change
 * with no paper trail.
 */
export interface ProposalDraft {
    /**
     * Which applier carries this out — namespaced like a tool name, e.g.
     * `content.entry.update`. Matched exactly against
     * {@link ProposalApplier.kind}.
     */
    kind: string;
    /** Where the change lands. */
    target: ProposalTarget;
    /** The change itself, in whatever shape the applier's use-case takes. */
    patch: Readonly<Record<string, unknown>>;
    /** One line naming the change — the card's title and the model's receipt. */
    summary: string;
    /**
     * Per-field before/after for the review UI. Optional because not every
     * change is field-shaped, but supply it whenever it is: a diff is the whole
     * reason a human can decide in a second rather than a minute.
     */
    changes?: readonly ProposalChange[];
}

/**
 * What happened to a proposal.
 *
 * There is no `applied` state distinct from `accepted`: accepting *is*
 * applying — the use-case runs inside the accept, and a failure leaves the row
 * `pending` with its error recorded rather than stranding it in a fourth state
 * nobody clears.
 *
 * Since [ADR-0009](../../../../../docs/adr/0009-copilot-applies-directly.md)
 * the engine applies every proposal as it is drafted, so a *new* row only ever
 * lands `accepted`, or stays `pending` because the apply failed — which the UI
 * reads as "Ortha AI could not make this change". `rejected` is no longer
 * produced and is kept only because rows written before that change still carry
 * it; a reader must still handle all three.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Runtime guard for a value a `propose` tool returned.
 *
 * The engine trusts `effect: 'propose'` to mean "this returns a draft", and a
 * binder that gets it wrong would otherwise write a malformed row into an
 * append-only table. Checking here turns that into an ordinary tool error the
 * model can report, which is the same treatment every other binder bug gets.
 */
export function isProposalDraft(value: unknown): value is ProposalDraft {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<ProposalDraft>;
    return (
        typeof draft.kind === 'string' &&
        draft.kind.length > 0 &&
        typeof draft.summary === 'string' &&
        isJsonObject(draft.target) &&
        isJsonObject(draft.patch)
    );
}

/**
 * A non-null, non-array object — what `target` and `patch` are declared as.
 *
 * `typeof [] === 'object'` in JavaScript, so a bare `typeof` check lets an
 * array through: a binder returning `target: []` would write a
 * `copilot_proposals` row whose target addresses nothing, into an append-only
 * table, and the applier would then be handed a shape its `kind` never
 * described. Arrays are excluded here so that stays an ordinary tool error.
 */
function isJsonObject(
    value: unknown
): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
