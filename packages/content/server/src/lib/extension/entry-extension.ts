/**
 * The entries **extension port** — the seam through which a downstream plugin
 * (e.g. a localization plugin) extends the generic entries pipeline without
 * this package knowing its domain. Content-server *declares* the port and
 * consults it optionally (`@Optional()` injection) from {@link EntriesService}
 * and {@link EntryWriterService}; the extending plugin *binds* an
 * implementation to {@link CONTENT_ENTRY_EXTENSION} in its own module — the
 * same inversion as identity's `CONTENT_CATALOG`, with the roles swapped.
 *
 * Every method is called unconditionally when an extension is bound, for every
 * content type — an implementation MUST no-op (return `undefined` / `{}`) for
 * types it doesn't apply to, so binding an extension never changes the
 * behavior of unrelated types.
 *
 * NestJS-free on purpose (types + a Symbol only): implementations live in
 * other packages, and keeping decorators out means this file could move into
 * a decorator-free subpath without churn.
 *
 * Currently a **single binding**: one provider per app. If a second extension
 * ever needs to coexist, bind a composite that fans out to both — the port's
 * shape (SQL fragments AND-ed, column bags merged) composes cleanly.
 */

import type { SQL } from 'drizzle-orm';
import type { Database } from '@orthacms/database';
import type { FieldSchema, ParsedRule } from '@orthacms/utils-server';
import type { AnyContentType } from '../types/content-type';

/** DI token an extension plugin binds its {@link ContentEntryExtension} to. */
export const CONTENT_ENTRY_EXTENSION = Symbol('CONTENT_ENTRY_EXTENSION');

/**
 * Extension-owned request parameters, forwarded verbatim from the wire
 * (`?locale=` / `?localeFallback=` on reads, `body.locale` on create).
 * Content-server declares them on its DTOs — the strict global
 * `ValidationPipe` rejects undeclared keys, so a generic bag isn't possible —
 * but never interprets them; their semantics live entirely behind the port.
 */
export interface EntryScopeParams {
    /** Locale slug the request targets; validated by the extension. */
    locale?: string;
    /**
     * `'default'` widens {@link ContentEntryExtension.listScope} to fall back
     * to the default locale where the requested one is missing (used by the
     * admin's relation picker); absent = strict.
     */
    localeFallback?: string;
    /**
     * On **create**, the existing translation group the new row joins (making
     * it a sibling). Absent → the row starts its own fresh group. Validated by
     * the extension against the workspace.
     */
    localeGroupId?: string;
}

/**
 * Which write {@link ContentEntryExtension.afterUpdate} is running inside.
 *
 * The two are not symmetric, which is why the hook has to be told them apart.
 * On an **update** the edited row is the authority: what it now holds is what
 * the extension propagates outward. On a **create** it is the opposite — the
 * new row is the one with gaps to fill (a translation arrives carrying the
 * source's shared values but none of its links), so an extension that treated
 * it as the authority would push those gaps onto rows that were already right.
 */
export interface EntryWriteContext {
    /** True when the row was just INSERTed; false on an update. */
    created: boolean;
}

/**
 * What a write of one entry would **also** rewrite, beyond the row addressed.
 *
 * The entries pipeline does not know that a save can travel: an extension's
 * {@link ContentEntryExtension.afterUpdate} may rewrite a whole set of related
 * rows (the i18n plugin propagates a type's *shared* fields onto every sibling
 * in the translation group), and the caller that asked for "change this one
 * entry" has no way to see it. Everywhere a person types the change that is
 * tolerable — they are looking at the record and its language switcher. It is
 * not tolerable where an **agent** composes the change and it applies with no
 * human in between ([ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)),
 * which is what this exists for: the copilot's propose tools ask before they
 * draft, so the receipt names the blast radius instead of reading as a
 * single-entry edit.
 *
 * It describes; it does not decide. Propagating shared values IS the contract —
 * "shared" means shared — so refusing the write would take away the only way to
 * edit a shared field at all. The defect was that nobody was told.
 */
export interface EntryWriteFanout {
    /**
     * The names of the fields **in the submitted values** whose value travels
     * to the other rows — a subset of what was asked for, never the whole type.
     */
    fields: readonly string[];
    /**
     * The other rows, named the way a person would recognise them (locale
     * slugs, for the i18n extension). Never empty: an extension returns
     * `undefined` rather than an empty description.
     */
    locales: readonly string[];
}

/** Context handed to {@link EntryFilterExtension.resolve} with each rule. */
export interface EntryFilterContext {
    /** The content type the list request targets. */
    type: AnyContentType;
    /** The requesting workspace — every emitted subquery MUST scope to it. */
    workspaceId: string;
}

/**
 * Virtual filter fields an extension contributes to one type's `?filter=`
 * schema — e.g. "has locale", "locale count" — resolved to SQL subqueries by
 * the extension itself via the filter engine's `resolveExtension` hook.
 */
export interface EntryFilterExtension {
    /**
     * Parser declarations for the virtual fields, merged into the type's
     * `FilterSchema.fields` and registered as `extensionFields` (so the
     * translator routes them here instead of to a column).
     */
    fields: FieldSchema;
    /** Translate one virtual-field rule into a SQL predicate. */
    resolve(rule: ParsedRule, context: EntryFilterContext): Promise<SQL>;
}

/**
 * A transaction handle of the shared Drizzle client — what
 * {@link ContentEntryExtension.afterUpdate} receives so its writes commit or
 * roll back with the triggering update.
 */
export type EntryTransaction = Parameters<
    Parameters<Database['transaction']>[0]
>[0];

/**
 * The operations the entries pipeline consults an extension for. All methods
 * are required — a no-op is `undefined`/`{}`, keeping call sites branch-free.
 */
export interface ContentEntryExtension {
    /**
     * An extra predicate AND-ed into the list WHERE (alongside the workspace
     * scope, search, filter tree, and soft-delete guard). Interprets and
     * validates {@link EntryScopeParams} — throw a `BadRequestException` for
     * an invalid value. Return `undefined` to add nothing.
     */
    listScope(
        type: AnyContentType,
        workspaceId: string,
        params: EntryScopeParams
    ): SQL | undefined;

    /**
     * Virtual filter fields for the type's `?filter=` schema, or `undefined`
     * when the extension adds none for this type.
     */
    filterExtension(type: AnyContentType): EntryFilterExtension | undefined;

    /**
     * Extra envelope columns stamped onto the INSERT of a create (merged over
     * the field columns + `workspaceId`). Interprets/validates
     * {@link EntryScopeParams} — may throw (e.g. an unknown locale or a
     * `localeGroupId` that names no group in the workspace). Return `{}` to add
     * nothing. May be async (the group check reads the DB); the caller awaits.
     */
    createColumns(
        type: AnyContentType,
        workspaceId: string,
        params: EntryScopeParams
    ): Record<string, unknown> | Promise<Record<string, unknown>>;

    /**
     * Runs as the **first statement inside the create and update
     * transactions**, before the row itself is touched — the seam for taking a
     * deterministic, transaction-scoped lock over the wider set the extension
     * will write in {@link afterUpdate}.
     *
     * It exists because ordering the extension's own locks is not enough. By
     * the time {@link afterUpdate} runs, this transaction already holds a row
     * lock on the entry being saved (the pipeline's `UPDATE … RETURNING`), and
     * that lock was taken outside any ordering the extension controls. Two
     * concurrent saves on two members of the same extension-defined set (two
     * locales of one translation group) therefore each hold a row the other is
     * about to request — a textbook lock-order inversion that Postgres resolves
     * by aborting one with `deadlock detected` (SQLSTATE 40P01), surfacing as a
     * 500. A lock taken *here* precedes every row lock, so it imposes a total
     * order on the set and the inversion becomes unreachable.
     *
     * Optional: an extension that writes only the row it was handed needs
     * nothing. `params` carries the extension-owned scope of the write
     * ({@link EntryScopeParams}) — on an update the pipeline fills in the
     * **stored** row's values, not the request's, since that is the set the
     * write actually contends on.
     */
    beforeWrite?(
        tx: EntryTransaction,
        type: AnyContentType,
        params: EntryScopeParams,
        workspaceId: string
    ): Promise<void>;

    /**
     * Runs inside the **create and update** transactions, after the row's
     * columns and relation deltas are written — e.g. to propagate shared values
     * to sibling rows (so a newly-created sibling lands consistent with its
     * group, and an edit re-syncs). A throw rolls the whole save back. The
     * implementation must no-op when there are no siblings to affect.
     *
     * Returns the **other rows it changed**, if any. The entries pipeline
     * appends a revision for each, in the same transaction — so a row whose
     * values an extension rewrote gets the history entry it earned, instead of
     * its timeline silently skipping the change.
     *
     * Revision writing deliberately stays here rather than in the extension:
     * numbering is serialized per entry by an advisory lock, and a second
     * writer allocating numbers out-of-band is how duplicate versions happen.
     *
     * An implementation MAY amend `row` **in place** for columns it derives for
     * that row itself (the i18n sync resolves a mirrored relation into the new
     * row's own locale on create). The caller snapshots `row` *after* this
     * call, so an in-place amendment lands in the revision; writing only to the
     * database would leave the first version describing something the row never
     * held.
     */
    afterUpdate(
        tx: EntryTransaction,
        type: AnyContentType,
        row: Record<string, unknown>,
        values: Record<string, unknown>,
        workspaceId: string,
        context: EntryWriteContext
    ): Promise<Record<string, unknown>[] | void>;

    /**
     * What a write of `values` onto `entryId` would rewrite **besides that
     * row** — the read-only counterpart of {@link afterUpdate}, answered before
     * anything is written.
     *
     * The pipeline itself never calls it: a save just saves, and the fan-out is
     * the extension's own contract. It is asked by callers that have to
     * *describe* a change before making it — the copilot's `content_propose_*`
     * tools, whose receipt is the only place a user learns their content moved.
     *
     * Return `undefined` — not an empty description — when the write touches
     * nothing else: the type is not the extension's, no field in `values`
     * travels, or the row has no companions. Callers treat `undefined` as "an
     * ordinary single-row edit" and say nothing, which is the common case and
     * must stay silent.
     *
     * Reads only, and takes **no locks**: it runs outside the write
     * transaction and its answer is advisory by construction — a sibling can
     * appear between the description and the write. Locking here would put a
     * `FOR UPDATE` on a translation group for the duration of a model's turn.
     *
     * Optional: an extension that only ever writes the row it was handed has
     * nothing to describe.
     */
    describeFanout?(
        type: AnyContentType,
        entryId: string,
        values: Record<string, unknown>,
        workspaceId: string
    ): Promise<EntryWriteFanout | undefined>;
}
