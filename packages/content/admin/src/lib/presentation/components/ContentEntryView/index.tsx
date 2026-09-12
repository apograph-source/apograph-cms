import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    Spinner,
    toast
} from '@orthacms/design-system';
import type {
    ContentType,
    ContentTypeDetail,
    EntryRecord,
    RelationDelta
} from '../../../domain/types/contentType';
import {
    CONTENT_FIELD_TYPE,
    CONTENT_SEGMENT,
    DEFAULT_ENTRY_TAB,
    ENTRY_MODE,
    NEW_SEGMENT,
    type EntryMode
} from '../../../domain/constants';
import { entryTabFromPath } from '../../../domain/entryTab';
import { listParamsQuery } from '../../../domain/listParamsQuery';
import { useContentSchema } from '../../../application/useContentSchema';
import {
    useContentEntries,
    contentEntriesPrefix,
    type ContentEntriesResult
} from '../../../application/useContentEntries';
import {
    useContentEntry,
    contentEntryKey
} from '../../../application/useContentEntry';
import { usePublishEntryFlow } from '../../../application/usePublishEntryFlow';
import { useSlotListParams } from '../../hooks/useSlotListParams';
import { EntrySlotContextProvider } from '../../hooks/useEntrySlotContext';
import {
    ENTRY_PARAMS_SLOT,
    ENTRY_PRESAVE_SLOT,
    type EntryPresaveResult,
    type EntrySlotContext
} from '../../slots/contentSlots';
import {
    emptyEntryValues,
    mergeEntryValues
} from '../../../domain/emptyEntryValues';
import { EntryEditor } from './EntryEditor';
import {
    EntryBusyOverlay,
    ENTRY_BUSY,
    type EntryBusy
} from './EntryBusyOverlay';

const messages = defineMessages({
    newTitle: { id: 'content.entry.newTitle', defaultMessage: 'New {label}' },
    loadError: {
        id: 'content.entry.loadError',
        defaultMessage: 'Couldn’t load this entry. Please try again.'
    },
    retry: { id: 'content.entry.retry', defaultMessage: 'Retry' },
    savedCreate: {
        id: 'content.entry.savedCreate',
        defaultMessage: '{label} created.'
    },
    savedUpdate: {
        id: 'content.entry.savedUpdate',
        defaultMessage: 'Changes saved.'
    },
    savedPublish: {
        id: 'content.entry.savedPublish',
        defaultMessage: '{label} published.'
    },
    savedDraft: {
        id: 'content.entry.savedDraft',
        defaultMessage: '{label} moved to draft.'
    },
    deleted: {
        id: 'content.entry.deleted',
        defaultMessage: '{label} deleted.'
    },
    actionError: {
        id: 'content.entry.actionError',
        defaultMessage: 'Something went wrong. Please try again.'
    }
});

/** Re-exported for the route adapters that render this view. */
export type { EntryMode };

/** The one-entry query params reused for `single` resolution. */
const ONE_ENTRY = { page: 1, pageSize: 1 } as const;

/** A many/inverse relation whose links are managed live (paginated + deltas). */
function isLinkManaged(field: ContentTypeDetail['fields'][number]): boolean {
    return (
        field.type === CONTENT_FIELD_TYPE.Relation &&
        (!!field.relation?.many || !!field.relation?.inverse)
    );
}

/**
 * Prepare an entry's relation fields for the form (**every** mode). An owning
 * **single** relation stays a form value — its FK id rides in the entry read's
 * `values` (or `''` on create), saved back with the document. A many/inverse
 * relation is **link-managed** — staged and sent as an append/unlink **delta**,
 * never in `values` — so its key is **dropped** from the form entirely. This is
 * what keeps a save from ever *replacing* a many-relation: the editor can't
 * submit `values[field]`, so the whole-set `writeLinks` path (which an empty
 * array would clear) is never reached; only the additive delta path runs.
 */
function seedRelationValues(
    schema: ContentTypeDetail,
    base: Record<string, unknown>
): Record<string, unknown> {
    const values = { ...base };
    for (const field of schema.fields) {
        if (field.type !== CONTENT_FIELD_TYPE.Relation) continue;
        if (isLinkManaged(field)) delete values[field.name];
    }
    return values;
}

/**
 * Seed a blank create form from a source record's values, copying **only the
 * non-localized (shared) fields** — used when a locale plugin opens a draft for
 * a new translation (`location.state.translateFrom`). Localized fields stay
 * empty so the translator fills them; a field the schema marks `localized`
 * (only ever present on i18n types) is skipped. No-op when there's nothing to
 * copy from.
 */
function applyTranslatePrefill(
    schema: ContentTypeDetail,
    base: Record<string, unknown>,
    translateFrom: Record<string, unknown> | undefined
): Record<string, unknown> {
    if (!translateFrom) return base;
    const values = { ...base };
    for (const field of schema.fields) {
        if (field.localized) continue; // localized → left blank per locale
        if (field.name in translateFrom) {
            values[field.name] = translateFrom[field.name];
        }
    }
    return values;
}

/**
 * Hosts the {@link EntryEditor} for all three modes:
 * - `create` (`/:type/new`) → a blank editor;
 * - `edit` (`/:type/:entryId`) → the record from `GET /content/:type/:id`, seeded
 *   instantly from the records-list cache when opened from the table;
 * - `single` (a page) → the type's one entry via the list endpoint, or a blank
 *   create when it has none.
 *
 * Saving persists via {@link useSaveEntry} (create/update); a publish chains the
 * dedicated publish endpoint ({@link useEntryStatusActions}) so it runs the same
 * validated path as the row/bulk publish. A 422 is handed back to the editor's
 * form as inline field errors (it rejects the `onSave` promise).
 */
export function ContentEntryView({
    type,
    mode,
    entryId
}: {
    type: ContentType;
    mode: EntryMode;
    entryId?: string;
}) {
    const intl = useIntl();
    const navigate = useNavigate();
    const location = useLocation();
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    const typePath = `/workspaces/${workspace.id}/${CONTENT_SEGMENT}/${type.name}`;

    // A slot may open a blank create form pre-seeded from a source record (the
    // i18n plugin's "create a translation" flow passes the source's values as
    // `translateFrom`); the shared (non-localized) fields are copied in.
    const prefillState = location.state as {
        translateFrom?: Record<string, unknown>;
        translateFromLocale?: string;
    } | null;
    const translateFrom = prefillState?.translateFrom;
    // The locale the copied shared values were written in. Only meaningful
    // while they are still a prefill — once saved, `values` is just this row's
    // data and nothing distinguishes a translated field from an untouched one.
    const translateFromLocale = prefillState?.translateFromLocale;

    const schemaQuery = useContentSchema(type.name);
    const schema = schemaQuery.data;

    // Slot-contributed entry params (e.g. the i18n plugin's `?locale=`): URL
    // values scoping the single-mode read, and URL values copied into the
    // create body. Slot items are boot-frozen, so reading them is stable.
    const entryParamsItems = ENTRY_PARAMS_SLOT.getItems();
    const listParamKeys = useMemo(
        () => entryParamsItems.flatMap((item) => item.listParamKeys ?? []),
        [entryParamsItems]
    );
    const listSlotParams = useSlotListParams(listParamKeys);
    const bodyParamKeys = useMemo(
        () => entryParamsItems.flatMap((item) => item.createBodyKeys ?? []),
        [entryParamsItems]
    );
    const bodySlotParams = useSlotListParams(bodyParamKeys);

    // Slot-contributed **save steps** (the media plugin's staged uploads). Their
    // hooks are mounted here — above the editor, so their staging outlives a tab
    // switch — and called unconditionally in slot order, which is safe because
    // slot items are boot-frozen. Each one's `commit` runs inside `onSave`,
    // before the write and under the same busy cover.
    const presaveItems = ENTRY_PRESAVE_SLOT.getItems();
    const presaves = presaveItems.map((item) => item.usePresave());
    const presaveHandles = Object.fromEntries(
        presaveItems.map((item, index) => [item.id, presaves[index]?.handle])
    );
    // Whether any presave step is holding staged state — an edited audience,
    // say. Asked the same way the save asks it a few lines below, because it is
    // the same question at a different moment: **will this press write a new
    // version?** A publish guard that judged the stored head while the press
    // was about to append a revision would unlock a button the API then
    // refuses, and staged extensions are the half the form's own dirty flag
    // cannot see. `extensions()` is a read of staged state by contract — the
    // step returns undefined when it holds nothing — so calling it on render is
    // the same query the write makes, not a side effect.
    const extensionsStaged = presaves.some(
        (step) => Object.keys(step.extensions?.() ?? {}).length > 0
    );

    // The slot-owned list params (e.g. `?locale=de`) this editor was opened
    // under, as a query suffix. The records table puts them on every row link,
    // and every route out of the editor carries them back — otherwise "Back to
    // records" returns to a different locale than the one the user came from.
    const entryQuerySuffix = listParamsQuery(listSlotParams);

    // The open tab is a **route** segment, not editor state: switching locale
    // remounts the editor at the sibling's id, and local state reset the user to
    // General mid-task.
    const tab = entryTabFromPath(location.pathname);

    // The editor's own base path — a collection row carries its id, a single is
    // mounted on the type itself. Tab links hang off it, and the query suffix
    // rides along so a tab change never drops the active locale.
    const editorPath =
        mode === ENTRY_MODE.Single
            ? typePath
            : `${typePath}/${entryId ?? NEW_SEGMENT}`;

    // The open tab as a path segment (`''` on the default tab, so the bare
    // entry URL stays canonical) — used for the editor's own tab links and
    // handed to slots that navigate to a sibling record.
    const tabSegment = tab === DEFAULT_ENTRY_TAB ? '' : `/${tab}`;

    const onTabChange = (next: string) => {
        const segment = next === DEFAULT_ENTRY_TAB ? '' : `/${next}`;
        // A tab change stays on the *same* form, so it carries the URL forward
        // whole — `location.search`, not just the list params. The create route
        // also carries create-only params (the i18n plugin's `localeGroupId`,
        // which joins the new row to a translation group); dropping those here
        // would quietly turn a translation into an orphan record on save.
        //
        // `location.state` rides along too: it holds the create-form prefill a
        // slot handed us (`translateFrom`, the source record's shared fields),
        // and this view re-reads it on every render — so navigating without it
        // would reset a half-filled translation form to blank.
        navigate(`${editorPath}${segment}${location.search}`, {
            state: location.state
        });
    };

    // `single` resolves its one row via the list endpoint; other modes don't fetch.
    const oneEntryQuery = useContentEntries(
        schema,
        {
            ...ONE_ENTRY,
            ...(listParamKeys.length ? { extra: listSlotParams } : {})
        },
        mode === ENTRY_MODE.Single && !!schema
    );

    // Seed edit mode from the records-list cache (the common "opened from the
    // table" path) so the form is instant. The seed carries the **age of the list
    // read** it came from, not "now": the entry query has a `staleTime`, so
    // claiming a ten-minute-old list row was just fetched would let the editor
    // trust it for another window instead of re-reading.
    const cachedEntry = useMemo(() => {
        if (mode !== ENTRY_MODE.Edit || !entryId) return undefined;
        const cached = queryClient.getQueriesData<ContentEntriesResult>({
            queryKey: contentEntriesPrefix(workspace.id, type.name)
        });
        for (const [key, data] of cached) {
            const hit = data?.items.find((item) => item.id === entryId);
            if (hit) {
                return {
                    entry: hit,
                    updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt
                };
            }
        }
        return undefined;
    }, [mode, entryId, queryClient, type.name, workspace.id]);

    const entryQuery = useContentEntry(type.name, entryId, {
        initialData: cachedEntry?.entry,
        initialDataUpdatedAt: cachedEntry?.updatedAt,
        enabled: mode === ENTRY_MODE.Edit
    });

    // The single page's existing row (if any).
    const singleEntry = oneEntryQuery.data?.items[0];

    // Identifies the current edit target for the flow hook: mode + record id +
    // the create-body params (the i18n plugin's target `locale`/`localeGroupId`).
    // The editor is reused (not remounted) as the route flips between `/new`,
    // `/:id`, and a fresh `/new?locale=…` translation create, so the flow keys its
    // remembered create id on this to avoid PATCHing the prior record after a
    // locale switch. Stable within one create session (only these inputs change).
    const editorKey = useMemo(
        () => `${mode}:${entryId ?? ''}:${JSON.stringify(bodySlotParams)}`,
        [mode, entryId, bodySlotParams]
    );

    // The save/publish use case: owns the save→publish/unpublish sequencing, the
    // create→update id continuity, and the shared-kernel publish gate.
    const flow = usePublishEntryFlow(type.name, editorKey);

    // Which write is covering the screen. Held by this view rather than derived
    // from the mutations' `isPending`, because one submit is a **chain** (save →
    // publish) whose two mutations are briefly both idle between steps — deriving
    // it would blink the cover mid-flow. Set before the first request and cleared
    // only once everything, refetches included, has settled.
    const [busy, setBusy] = useState<EntryBusy | null>(null);

    const editEntry = entryQuery.data;

    // Resolve the editor's initial values, the source record (for metadata), and
    // the id we'd update — memoized so the form re-seeds only on identity change.
    // Relation fields are seeded from the dedicated relations read (covering
    // many-to-many / inverse links the entry row doesn't carry), so the form
    // holds the full assigned set.
    const resolved = useMemo((): {
        values: Record<string, unknown>;
        entry?: EntryRecord;
    } | null => {
        if (!schema) return null;
        // A blank create form, optionally pre-seeded with the shared fields of
        // a source record (translation flow).
        const blank = () =>
            seedRelationValues(
                schema,
                applyTranslatePrefill(
                    schema,
                    emptyEntryValues(schema),
                    translateFrom
                )
            );
        if (mode === ENTRY_MODE.Create) {
            return { values: blank() };
        }
        const source = mode === ENTRY_MODE.Edit ? editEntry : singleEntry;
        if (source) {
            return {
                values: seedRelationValues(
                    schema,
                    mergeEntryValues(schema, source.values)
                ),
                entry: source
            };
        }
        // A single page with no row yet falls back to a blank create form.
        return mode === ENTRY_MODE.Single ? { values: blank() } : null;
    }, [schema, mode, editEntry, singleEntry, translateFrom]);

    const loading =
        schemaQuery.isPending ||
        (mode === ENTRY_MODE.Single && oneEntryQuery.isPending) ||
        (mode === ENTRY_MODE.Edit && entryQuery.isPending);
    const errored =
        schemaQuery.isError ||
        !schema ||
        (mode === ENTRY_MODE.Single && oneEntryQuery.isError) ||
        // Only fatal when there's no record to show — a background refetch
        // failure on a cache-seeded edit keeps the form usable.
        (mode === ENTRY_MODE.Edit && entryQuery.isError && !editEntry);

    if (loading) {
        return (
            <Container className="max-w-none p-4 sm:p-6">
                <ContainerHeader titleClassName="text-lg" title={type.label} />
                <div className="mt-8 flex justify-center">
                    <Spinner aria-hidden />
                </div>
            </Container>
        );
    }

    if (errored || !schema || !resolved) {
        return (
            <Container className="max-w-none p-4 sm:p-6">
                <ContainerHeader
                    titleClassName="text-lg"
                    title={schema?.label ?? type.label}
                />
                <Alert variant="destructive" role="alert" className="mt-4">
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span>{intl.formatMessage(messages.loadError)}</span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="shadow-none"
                            onClick={() => {
                                schemaQuery.refetch();
                                if (mode === ENTRY_MODE.Single)
                                    oneEntryQuery.refetch();
                                if (mode === ENTRY_MODE.Edit)
                                    entryQuery.refetch();
                            }}
                        >
                            {intl.formatMessage(messages.retry)}
                        </Button>
                    </AlertDescription>
                </Alert>
            </Container>
        );
    }

    const isCreate = resolved.entry === undefined;
    const publishable = schema.publishable ?? false;
    const title =
        mode === ENTRY_MODE.Create
            ? intl.formatMessage(messages.newTitle, { label: schema.label })
            : schema.label;

    // Persist, then (optionally) publish, via the use-case flow. Rejects on a
    // server error so the editor can surface a 422's field issues; resolves on
    // success after toast + nav.
    const onSave = async (
        values: Record<string, unknown>,
        options: {
            publish: boolean;
            relations?: Record<string, RelationDelta>;
            /** Fields the editor hid/skipped, so the flow's gate matches the form. */
            ignoreFields?: ReadonlySet<string>;
            /** Whether the editor holds anything unsaved (values or staged links). */
            dirty?: boolean;
            /** Whether to publish past a publish guard, forwarded as is. */
            bypass?: boolean;
        }
    ) => {
        // Slot-contributed create-body params (e.g. the target locale), from the
        // URL. Present values only; applies to the create POST alone.
        const bodyExtra = Object.fromEntries(
            Object.entries(bodySlotParams).filter(
                (pair): pair is [string, string] => pair[1] !== undefined
            )
        );
        // Cover the editor for the whole write — including the refetches the
        // mutation awaits — so the form never sits half-updated under the user's
        // cursor. `finally`, so a 422 uncovers the form it has to annotate.
        setBusy(
            options.publish && publishable
                ? ENTRY_BUSY.Publishing
                : ENTRY_BUSY.Saving
        );
        // Slot-contributed save steps run first, under the cover, and may rewrite
        // the values — this is where the media plugin uploads the files staged on
        // media fields and swaps in the real asset ids. A step that throws aborts
        // the save (it has already surfaced its own failure); nothing is written,
        // so the values keep their placeholders and a retry resumes where it got
        // to rather than re-uploading.
        let toSave = values;
        try {
            for (const step of presaves) {
                toSave = await step.commit({
                    values: toSave,
                    publish: options.publish
                });
            }
        } catch (error) {
            setBusy(null);
            throw error;
        }
        // Plugin state stored alongside the entry (segments' audiences), read
        // after `commit` so a step may stage it there. It rides the save body
        // rather than a request of its own, which is what makes the entry, the
        // plugin's state and the version recording both one transaction.
        const extensions = Object.assign(
            {},
            ...presaves.map((step) => step.extensions?.() ?? {})
        ) as Record<string, unknown>;
        let result: Awaited<ReturnType<typeof flow.submit>>;
        try {
            result = await flow.submit({
                schema,
                publishable,
                values: toSave,
                publish: options.publish,
                relations: options.relations,
                entry: resolved.entry,
                bodyExtra,
                extensions,
                ignoreFields: options.ignoreFields,
                // Unchanged means the form, its staged links **and** every
                // presave step's plugin state — an edited audience is a change
                // the form's own dirty flag cannot see.
                unchanged:
                    options.dirty === false &&
                    !options.relations &&
                    Object.keys(extensions).length === 0,
                bypass: options.bypass
            });
            // The write landed, so every presave step can drop what it consumed
            // (the media plugin revokes its preview URLs and forgets the staged
            // files — the saved record now carries the real ids) and do the work
            // that needed the saved record (the segments plugin writes the
            // entry's audiences, which on a create has only just become
            // addressable). Inside the cover, and awaited, because that second
            // kind is a write of its own.
            const settled: EntryPresaveResult = {
                entry: result.saved,
                schema,
                created: result.wasCreate,
                published: result.published
            };
            for (const step of presaves) {
                // The entry is already written, so a failure here cannot abort
                // anything — the step has surfaced it itself, and swallowing it
                // is what keeps a landed save from being reported as a failure.
                try {
                    await step.settle?.(settled);
                } catch {
                    /* the step owns its own failure */
                }
            }
        } finally {
            setBusy(null);
        }
        toast.success(
            intl.formatMessage(
                result.published
                    ? messages.savedPublish
                    : result.unpublished
                      ? messages.savedDraft
                      : isCreate
                        ? messages.savedCreate
                        : messages.savedUpdate,
                { label: schema.label }
            )
        );
        // Stay on the editor after a save — surface success via the toast, don't
        // bounce back to the records list. A brand-new record (create, incl. a
        // translation sibling) moves to its own editor URL so the id is in the
        // URL and a further save updates it; an existing record is already there
        // and its invalidated query refreshes in place. A single stays put — its
        // `?locale=` re-resolves to the row just created.
        if (mode !== ENTRY_MODE.Single && result.wasCreate) {
            // Prime the edit-mode read with the record the save just returned.
            // Without it the navigation below lands on `/:type/:id` with a cold
            // query, so the editor swaps the form the user is looking at for a
            // full-page spinner and a header that flips "New {label}" → "{label}"
            // — a jarring flash on every create. The response *is* the canonical
            // record, so there is nothing to wait for.
            queryClient.setQueryData(
                contentEntryKey(workspace.id, type.name, result.saved.id),
                result.saved
            );
            navigate(
                `${typePath}/${result.saved.id}${tabSegment}${entryQuerySuffix}`
            );
        }
    };

    // Entry-level actions are available only when editing an existing collection
    // row (not on create, not on a single page).
    const editId = mode === ENTRY_MODE.Edit ? resolved.entry?.id : undefined;

    const onActionError = () =>
        toast.error(intl.formatMessage(messages.actionError));

    // No explicit `refetch()` after this: the mutation primes the read-one cache
    // with the record it returned and refreshes the rest. The old refetch raced
    // its own invalidation — `cancelRefetch` aborted the in-flight read and
    // issued a second one, so an unpublish cost two reads of the same record.
    const onUnpublish =
        editId && publishable
            ? () => {
                  setBusy(ENTRY_BUSY.Saving);
                  flow.unpublish(editId)
                      .catch(onActionError)
                      .finally(() => setBusy(null));
              }
            : undefined;

    const onDelete = editId
        ? () => {
              flow.remove(editId)
                  .then(() => {
                      toast.success(
                          intl.formatMessage(messages.deleted, {
                              label: schema.label
                          })
                      );
                      navigate(`${typePath}${entryQuerySuffix}`);
                  })
                  .catch(onActionError);
          }
        : undefined;

    // The context handed to entry-editor slot consumers (sidebar widgets, the
    // relation picker's param contributions) — both via the provider below and
    // as an explicit prop where a render site maps slot items.
    const slotContext: EntrySlotContext = {
        schema,
        entry: resolved.entry,
        isCreate,
        mode,
        workspaceId: workspace.id,
        typePath,
        // The entry-params URL values (opaque), so a slot can scope by its own
        // param even on a create form — e.g. i18n reads `?locale=` here to keep
        // the relation picker in-locale when there's no saved `entry` yet.
        params: { ...listSlotParams, ...bodySlotParams },
        tabSegment
    };

    // `flex-auto` (not `min-h-full`): fills the pane's remaining height under
    // the sticky top bar when short, grows with content when tall — without
    // forcing a permanent pane scroll.
    return (
        <div className="flex flex-auto flex-col">
            <EntryBusyOverlay busy={busy} />
            <EntrySlotContextProvider value={slotContext}>
                <EntryEditor
                    schema={schema}
                    initialValues={resolved.values}
                    entry={resolved.entry}
                    isCreate={isCreate}
                    publishable={publishable}
                    title={title}
                    subtitle={schema.description}
                    saving={flow.isSaving}
                    mutating={flow.isMutating}
                    onSave={onSave}
                    onUnpublish={onUnpublish}
                    onDelete={onDelete}
                    backTo={
                        mode === ENTRY_MODE.Single
                            ? undefined
                            : `${typePath}${entryQuerySuffix}`
                    }
                    availableTypeNames={workspace.content}
                    {...(isCreate && translateFromLocale
                        ? { prefilledFromLocale: translateFromLocale }
                        : {})}
                    presave={presaveHandles}
                    extensionsStaged={extensionsStaged}
                    tab={tab}
                    onTabChange={onTabChange}
                />
            </EntrySlotContextProvider>
        </div>
    );
}
