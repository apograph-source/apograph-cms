import type { ProposalTarget } from './proposal';

/** Who a proposal is being applied on behalf of, and from which run. */
export interface ProposalActor {
    /** The user whose authority the write runs under — never the copilot's. */
    userId: string;
    /**
     * That user's email.
     *
     * Carried because the audit trail freezes an email snapshot on every event
     * (`attachActor`), and an applier that had only an id would have to look it
     * up — a query per apply, in the one code path where getting the actor
     * wrong is least acceptable. It is the acting human's email in both cases:
     * the person who clicked Accept, or, on auto-apply, the person whose run
     * produced the change.
     */
    actorEmail: string;
    /** The workspace the proposal belongs to. */
    workspaceId: string;
    /** The run that produced it, recorded as provenance on the effect. */
    runId: string;
    /**
     * The proposal being applied, recorded alongside {@link runId}.
     *
     * Provenance, like `runId`: an applier stamps the pair onto the domain
     * event its write raises (see `proposalEventActor` in
     * `@orthacms/copilot-server`), so the audit row can say the change came
     * from an agent turn rather than from the person typing. The actor stays
     * the human either way — there is no copilot identity.
     */
    proposalId?: string;
}

/** What an applier hands back after carrying a proposal out. */
export interface ProposalApplyResult {
    /**
     * The entity the change landed on, so the UI can link to it — an entry id
     * for a content change, an asset id for a media one. Omitted when the
     * change has no addressable result.
     */
    entityId?: string;
    /**
     * Anything else worth recording on the proposal row: a new revision
     * number, the locale that was created. Shown in the accepted card.
     */
    detail?: Readonly<Record<string, unknown>>;
}

/**
 * Carries out one kind of proposal — the **write** half of the propose/apply
 * split, bound by the plugin that owns the data.
 *
 * The inversion is the same one the tool port uses, and for the same reason:
 * `copilot/server` must not import `content-server`, so applying a content
 * change cannot be something the copilot knows how to do. It knows only that
 * some plugin declared `content.entry.update` and will handle it.
 *
 * **An applier must run the ordinary use-case**
 * ([ADR-0005](../../../../../docs/adr/0005-copilot-authority-model.md) §5) —
 * the same one an HTTP request would reach, with the human as actor. That is
 * what makes an applied change validated, audited and revision-backed rather
 * than a second write path with its own bugs. An applier that reimplements the
 * write to "keep it simple" is the failure this port exists to prevent.
 */
export interface ProposalApplier {
    /** The `kind` this handles, matched exactly against a draft's. */
    readonly kind: string;
    /**
     * Applies the change and returns what happened. Throwing leaves the
     * proposal `pending` with the message recorded, so a transient failure is
     * retryable and a permanent one is legible.
     */
    apply(
        input: {
            target: ProposalTarget;
            patch: Readonly<Record<string, unknown>>;
        },
        actor: ProposalActor
    ): Promise<ProposalApplyResult>;
}

/**
 * DI token a host may bind a single {@link ProposalApplier} (or an array) to.
 *
 * As with `COPILOT_TOOL_PROVIDER`, the ordinary path is a **runtime
 * registration** from the binding plugin's own bootstrap — Nest cannot merge a
 * multi-provider token across independent dynamic modules, and every plugin
 * here is one.
 */
export const COPILOT_PROPOSAL_APPLIER = Symbol('COPILOT_PROPOSAL_APPLIER');
