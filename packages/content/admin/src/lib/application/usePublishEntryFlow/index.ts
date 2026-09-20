import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canPublish, type EntryFieldSpecMap } from '@orthacms/content-domain';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type {
    ContentTypeDetail,
    EntryRecord,
    RelationDelta
} from '../../domain/types/contentType';
import { ENTRY_STATUS } from '../../domain/constants';
import { toFieldSpec } from '../../infrastructure/entryFieldSpec';
import { useSaveEntry } from '../useSaveEntry';
import { useEntryStatusActions } from '../useEntryStatusActions';
import { refreshEntryCaches } from '../refreshEntryCaches';

/** One run of the save/publish use case. */
export type SubmitEntryInput = {
    /** The content type's full schema — its fields drive the publish gate. */
    schema: ContentTypeDetail;
    /** Whether the type is publishable (drives the publish/unpublish toggle). */
    publishable: boolean;
    /** The field values to persist. */
    values: Record<string, unknown>;
    /** Publish intent — the primary action asks to publish, the draft action doesn't. */
    publish: boolean;
    /** Staged many/inverse relation deltas to persist with the save. */
    relations?: Record<string, RelationDelta>;
    /** The record being edited, or undefined on a create / empty single page. */
    entry?: EntryRecord;
    /** Slot-contributed create-body params (create only). */
    bodyExtra?: Record<string, string>;
    /**
     * Slot-contributed plugin state stored alongside the entry (segments'
     * audiences), sent in the save's `extensions` bag on create **and** update.
     */
    extensions?: Record<string, unknown>;
    /**
     * Fields excluded from the publish gate — the hidden/ungranted relations the
     * editor also skipped in its client validation, so the flow's gate judges the
     * same value set the form did. (Link-managed many/inverse relations are skipped
     * by the kernel itself.)
     */
    ignoreFields?: ReadonlySet<string>;
    /**
     * Whether the submit carries nothing the stored record does not already
     * hold — no edited value, no staged link, no plugin state. A publish of an
     * **unchanged, saved** record then publishes it without saving first.
     *
     * The save is not free even when it changes nothing: every save appends a
     * version, and a version is what a review approval is bound to. Saving
     * before publishing moved the head off the version reviewers had just
     * approved, so the publish that followed was refused for the approval it
     * had itself made stale.
     */
    unchanged?: boolean;
    /**
     * Whether to publish past a publish guard, as its contribution confirmed —
     * forwarded to the publish request uninterpreted. See
     * `ENTRY_PUBLISH_GUARD_SLOT`.
     */
    bypass?: boolean;
    /**
     * Called the moment a write of this submit **lands**, before anything that
     * might still fail — the chained publish above all.
     *
     * Every entry write primes the read-one cache with its response, which
     * reaches the editor as a fresh seed for its form. The form refuses a seed
     * that would overwrite unsaved edits (`useEntryForm`, `ORT-230`), so the
     * editor has to adopt the one **it caused** — and it cannot tell that from
     * a colleague's, because both look like the same identity change. Only this
     * hook knows a write landed, and a landed save whose publish is then refused
     * is exactly the case where `submit` rejects with something already written.
     *
     * Called once per landed write, never on a write that failed.
     */
    onWriteLanded?: () => void;
};

/** The classified outcome of one submit, for the caller's toast + navigation. */
export type SubmitEntryResult = {
    /** The saved record returned by the write. */
    saved: EntryRecord;
    /** Whether the save was a create (no prior id — the caller navigates to it). */
    wasCreate: boolean;
    /** Whether the entry was published as part of this submit. */
    published: boolean;
    /** Whether an already-published entry was reverted to draft by this submit. */
    unpublished: boolean;
};

/** What {@link usePublishEntryFlow} exposes to the entry view. */
export type PublishEntryFlow = {
    /**
     * Runs the save use case: persist the values (+ staged relation deltas), then
     * — for a publishable type, when the intent is publish and the kernel
     * {@link canPublish} gate passes — publish. A plain save needs no extra step:
     * the server already moves a published entry to **draft** on save (its
     * previously-published *version* stays live in history), so the flow never
     * issues a separate unpublish (that would demote the published version too).
     * Resolves with the classified {@link SubmitEntryResult}; rejects on a server
     * error (e.g. a 422) so the editor can surface field issues.
     */
    submit: (input: SubmitEntryInput) => Promise<SubmitEntryResult>;
    /** Reverts a published entry to draft (the sidebar's Unpublish action). */
    unpublish: (id: string) => Promise<EntryRecord>;
    /** Soft-deletes the entry (the sidebar's Delete action). */
    remove: (id: string) => Promise<void>;
    /** Whether a save / publish / unpublish is in flight (drives the rail's busy state). */
    isSaving: boolean;
    /** Whether an unpublish or delete is in flight (disables the rail). */
    isMutating: boolean;
};

/**
 * The **save/publish use case** for one entry, factored out of the entry view so
 * the view renders the result instead of sequencing mutations itself. Owns the
 * create→update id continuity (a save after a failed publish updates the draft, it
 * doesn't create a second row), applies the shared `@orthacms/content-domain`
 * {@link canPublish} kernel gate before publishing (the single validation source,
 * the same rule the editor's publish gate shows), and exposes the entry lifecycle
 * mutations. Cache invalidation lives in the underlying mutations.
 *
 * Takes the stable `typeName` so it can be called unconditionally (before the
 * schema resolves); the schema and publishable flag are supplied per {@link submit}.
 *
 * `editorKey` identifies the current edit target (mode + record id + create-body
 * params such as the target locale). The editor is **not** remounted when the
 * route flips between `/new`, `/:id`, and `/new?locale=…` (the same component
 * renders all three — see `ContentLibraryPage`), so this hook's state survives
 * those transitions; the key lets it clear the remembered `createdId` when the
 * target genuinely changes. Without it, after creating record A a subsequent
 * "create a translation" (a fresh `/new` for another locale) would keep A's id
 * and issue a **PATCH against A** instead of a POST — overwriting A and creating
 * no sibling. The key must **not** change within a single create session (e.g. a
 * create that succeeds then fails to publish), so a retry still targets the draft.
 */
export function usePublishEntryFlow(
    typeName: string,
    editorKey?: string
): PublishEntryFlow {
    const save = useSaveEntry(typeName);
    const status = useEntryStatusActions(typeName);
    const queryClient = useQueryClient();
    const workspace = useCurrentWorkspace();
    // In create mode, remember the id returned by a successful create so a retry
    // after a failed chained publish updates that draft instead of re-creating.
    const [createdId, setCreatedId] = useState<string | undefined>(undefined);

    // Forget the remembered create id when the edit target changes (a different
    // record, or a new-translation create for another locale). The editor isn't
    // remounted across those navigations, so nothing else resets this state.
    useEffect(() => {
        setCreatedId(undefined);
    }, [editorKey]);

    const submit = useCallback(
        async (input: SubmitEntryInput): Promise<SubmitEntryResult> => {
            const existingId = input.entry?.id ?? createdId;

            // The publish gate over the same value set the editor validated: build
            // the kernel field-spec map, skipping the caller's ignored fields.
            // Decided **before** the save — it reads only the submitted values,
            // and the save needs to know whether a publish will follow so the two
            // writes share one cache-refresh pass instead of each running their
            // own (which refetched the record and its timeline twice per click).
            const fields: EntryFieldSpecMap = {};
            for (const field of input.schema.fields) {
                if (input.ignoreFields?.has(field.name)) continue;
                fields[field.name] = toFieldSpec(field);
            }
            const willPublish =
                input.publish &&
                input.publishable &&
                canPublish(fields, input.values);

            // Nothing to write: publish the stored record as it stands, which
            // leaves its head version — and the approvals bound to it — alone.
            if (willPublish && input.unchanged && existingId) {
                const published = await status.publish.mutateAsync({
                    id: existingId,
                    bypass: input.bypass
                });
                input.onWriteLanded?.();
                return {
                    saved: published,
                    wasCreate: false,
                    published: true,
                    unpublished: false
                };
            }

            const saved = await save.mutateAsync({
                id: existingId,
                values: input.values,
                relations: input.relations,
                deferRefresh: willPublish,
                ...(input.bodyExtra && Object.keys(input.bodyExtra).length
                    ? { extra: input.bodyExtra }
                    : {}),
                ...(input.extensions && Object.keys(input.extensions).length
                    ? { extensions: input.extensions }
                    : {})
            });
            // Record the new id before chaining publish: if publish then fails, the
            // draft persists and the user's retry must target it (not POST again).
            if (!existingId) setCreatedId(saved.id);
            // Same reason, for the editor's form: this write landed and has
            // already primed the read-one cache, so the seed it produced is the
            // editor's own and must be adopted **whatever the publish below
            // does**. Announced here rather than by the caller's `.then()`,
            // which a refused publish never reaches.
            input.onWriteLanded?.();

            // Saving a publishable entry as a draft moves it to draft **on the
            // server** (the save itself), while its previously-published *version*
            // stays live in history — so we must NOT issue a separate unpublish,
            // which would demote that published version too. The flag stays, only
            // to drive the "Saved as draft" toast.
            const revertedToDraft =
                !input.publish &&
                input.publishable &&
                input.entry?.status === ENTRY_STATUS.Published;

            if (willPublish) {
                try {
                    await status.publish.mutateAsync({
                        id: saved.id,
                        bypass: input.bypass
                    });
                } catch (error) {
                    // The save landed even though the publish didn't (a 422 from
                    // the server-side gate). Run the refresh the save deferred to
                    // this publish, so the timeline and list reflect the stored
                    // draft, then let the caller surface the field issues.
                    await refreshEntryCaches(
                        queryClient,
                        workspace.id,
                        typeName,
                        { primedEntryId: saved.id }
                    );
                    throw error;
                }
            }

            return {
                saved,
                wasCreate: !existingId,
                published: willPublish,
                unpublished: revertedToDraft
            };
        },
        [save, status, createdId, queryClient, workspace.id, typeName]
    );

    const unpublish = useCallback(
        (id: string) => status.unpublish.mutateAsync(id),
        [status]
    );
    const remove = useCallback(
        (id: string) => status.remove.mutateAsync(id),
        [status]
    );

    return {
        submit,
        unpublish,
        remove,
        isSaving:
            save.isPending ||
            status.publish.isPending ||
            status.unpublish.isPending,
        isMutating: status.unpublish.isPending || status.remove.isPending
    };
}
