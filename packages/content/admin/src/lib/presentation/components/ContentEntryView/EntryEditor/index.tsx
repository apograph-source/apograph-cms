import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import {
    ContainerHeader,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    ConfirmDialog,
    cn,
    toast
} from '@orthacms/design-system';
import type {
    ContentField,
    ContentTypeDetail,
    EntryRecord,
    RelationDelta,
    StagedRelation
} from '../../../../domain/types/contentType';
import { ApiError, useUnsavedChanges } from '@orthacms/utils-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageActionsPortal, RightPanelPortal } from '@orthacms/shell-admin';
import {
    CONTENT_CREATE,
    CONTENT_FIELD_TYPE,
    CONTENT_UPDATE,
    ENTRY_TAB,
    ENTRY_TAB_SLUGS
} from '../../../../domain/constants';
import { useEntryForm } from '../../../hooks/useEntryForm';
import { useEntrySlotContext } from '../../../hooks/useEntrySlotContext';
import { ExpandedFieldProvider } from '../../../hooks/useExpandedField';
import { EntryReadOnlyProvider } from '../../../hooks/useEntryReadOnly';
import {
    ENTRY_FIELD_CONTROL_SLOT,
    ENTRY_HEADER_SLOT,
    ENTRY_TAB_SLOT,
    type EntryFieldControlContext,
    type EntryPublishOptions,
    type EntryTabContext
} from '../../../slots/contentSlots';
import { useEntryRelations } from '../../../../application/useEntryRelations';
import { useEntryMedia } from '../../../../application/useEntryMedia';
import { entryIssuesFrom } from '../../../../infrastructure/entryIssues';
import { fieldLabel } from '../../../../domain/entryColumns';
import { entryTabForField } from '../../../../domain/entryTab';
import { toRelationIds } from '../../../../domain/relationIds';
import { EntryActions } from './EntryActions';
import { EntryChangedNotice } from './EntryChangedNotice';
import { EntryFieldSections } from './EntryFieldSections';
import { EntrySidebar, type PublishGateItem } from './EntrySidebar';
import { EntryTabIssues } from './EntryTabIssues';
import { HistoryTimeline } from './HistoryTimeline';
import { ReadOnlyNotice } from './ReadOnlyNotice';
import { RelationFieldSection } from './RelationFieldSection';

const messages = defineMessages({
    backToList: {
        id: 'content.editor.backToList',
        defaultMessage: 'Back to records'
    },
    tabGeneral: {
        id: 'content.editor.tabGeneral',
        defaultMessage: 'General'
    },
    tabRelations: {
        id: 'content.editor.tabRelations',
        defaultMessage: 'Relations'
    },
    tabHistory: {
        id: 'content.editor.tabHistory',
        defaultMessage: 'History'
    },
    relationsEmpty: {
        id: 'content.editor.relationsEmpty',
        defaultMessage: 'This content type has no relation fields.'
    },
    relationsSubtitle: {
        id: 'content.editor.relationsSubtitle',
        defaultMessage:
            'Assign related records and set the order they appear in the delivery API.'
    },
    relationRequired: {
        id: 'content.editor.relationRequired',
        defaultMessage: 'Needs at least one link'
    },
    sharedSaveTitle: {
        id: 'content.editor.sharedSaveTitle',
        defaultMessage: 'This also changes the other locales'
    },
    sharedSaveBody: {
        id: 'content.editor.sharedSaveBody',
        defaultMessage:
            'You changed {count, plural, one {the shared field “{first}”} other {# shared fields, starting with “{first}”}}. Shared fields aren’t translated — saving applies the new value to every locale of this record, not just this one.'
    },
    sharedSaveConfirm: {
        id: 'content.editor.sharedSaveConfirm',
        defaultMessage: 'Save anyway'
    },
    cancel: { id: 'content.editor.cancel', defaultMessage: 'Cancel' },
    propertiesPanel: {
        id: 'content.sidebar.panelTitle',
        defaultMessage: 'Properties'
    },
    publishBlocked: {
        id: 'content.editor.publishBlocked',
        defaultMessage:
            'Can’t publish — {count, plural, one {# field needs} other {# fields need}} attention. Start with “{field}”.'
    },
    saveBlocked: {
        id: 'content.editor.saveBlocked',
        defaultMessage:
            'Can’t save — {count, plural, one {# field needs} other {# fields need}} attention. Start with “{field}”.'
    },
    serverBlocked: {
        id: 'content.editor.serverBlocked',
        defaultMessage:
            'The server refused “{field}”: {message}. That field isn’t editable in this form — ask an administrator to change the content type.'
    },
    publishRefused: {
        id: 'content.editor.publishRefused',
        defaultMessage: 'Not published: {message}'
    },
    saveRefused: {
        id: 'content.editor.saveRefused',
        defaultMessage: 'Not saved: {message}'
    },
    writeFailed: {
        id: 'content.editor.writeFailed',
        defaultMessage: 'That didn’t go through. Try again.'
    }
});

/**
 * The server's own sentence for a refused write, when it sent one.
 *
 * A refusal that is not a field problem — a publish guard's 409 above all —
 * carries the only explanation there is in its body, and the transport error's
 * own message is "Request failed with status code 409".
 */
function serverMessage(error: unknown): string | undefined {
    if (!(error instanceof ApiError)) return undefined;
    const message = (error.details as { message?: unknown } | undefined)
        ?.message;
    return typeof message === 'string' && message.trim() ? message : undefined;
}

/** A field is hidden when its admin hints say so. */
function isHidden(field: ContentField): boolean {
    return (field.admin as { hidden?: boolean }).hidden === true;
}

/** An untouched relation staging — no pending link/unlink/reorder. */
const EMPTY_STAGED: StagedRelation = { added: [], removed: [], order: null };

/** Stable JSON of a value for dirty comparison (undefined ≡ null). */
const norm = (value: unknown) => JSON.stringify(value ?? null);

/** Whether a relation staging holds any pending change. */
function isStagedDirty(staged: StagedRelation): boolean {
    return (
        staged.added.length > 0 ||
        staged.removed.length > 0 ||
        staged.order !== null
    );
}

/** Serialize a relation staging to the wire delta sent on Save. */
function stagedToWire(staged: StagedRelation): RelationDelta {
    const delta: RelationDelta = {};
    if (staged.added.length) delta.link = staged.added.map((a) => a.id);
    if (staged.removed.length) delta.unlink = staged.removed;
    if (staged.order) delta.order = staged.order;
    return delta;
}

/**
 * The full entry editor: a title header, a tabbed body (**General** = grouped
 * field sections, **Relations** = relation fields, **Media** and **History** =
 * placeholders; all tabs always present), and a single monolithic right
 * {@link EntrySidebar} that owns the Save / Save&Publish / Cancel actions and a
 * collapsible details block. Owns the form state ({@link useEntryForm}) and the
 * `<form>`; persistence is the caller's `onSave`, called with the publish intent
 * so the same editor backs create / edit / single-page modes.
 */
export function EntryEditor({
    schema,
    initialValues,
    seedKey,
    entry,
    isCreate,
    publishable,
    title,
    subtitle,
    saving,
    mutating,
    onSave,
    onUnpublish,
    onDelete,
    backTo,
    availableTypeNames,
    prefilledFromLocale,
    presave,
    extensionsStaged,
    tab,
    onTabChange
}: {
    schema: ContentTypeDetail;
    initialValues: Record<string, unknown>;
    /**
     * Which record (or create session) `initialValues` belongs to, so the form
     * can tell "a different record opened" from "this record was read again"
     * — see {@link useEntryForm}. This editor is **reused**, not remounted, as
     * the route moves between records, so the distinction cannot be left to the
     * component lifecycle.
     */
    seedKey: string;
    entry?: EntryRecord;
    isCreate: boolean;
    publishable: boolean;
    title: string;
    subtitle?: string;
    saving: boolean;
    /** Whether an unpublish/delete action is in flight (disables the rail). */
    mutating?: boolean;
    onSave: (
        values: Record<string, unknown>,
        options: {
            publish: boolean;
            /** Staged many/inverse relation deltas to persist with the save. */
            relations?: Record<string, RelationDelta>;
            /**
             * Fields excluded from client validation (hidden/ungranted relations,
             * link-managed relations), forwarded so the save flow's publish gate
             * judges the same value set the form did.
             */
            ignoreFields?: ReadonlySet<string>;
            /**
             * Whether the form holds anything unsaved — so a publish of an
             * unchanged record can skip a save that would only move its head
             * version off the one reviewers approved.
             */
            dirty?: boolean;
            /** Whether to publish past a publish guard, forwarded as is. */
            bypass?: boolean;
            /**
             * Called the moment a write lands — before a chained publish that
             * may still be refused. The editor re-arms its form seeding here,
             * since a write it made primes the read-one cache and so produces a
             * seed of its own.
             */
            onWriteLanded?: () => void;
        }
    ) => Promise<void>;
    /** Revert a published entry to draft — only on a saved publishable entry. */
    onUnpublish?: () => void;
    /** Delete the entry — only on a saved entry. */
    onDelete?: () => void;
    /** Where the "Back to records" link goes; omitted for a single page. */
    backTo?: string;
    /**
     * Content-type names granted to the open workspace. A relation field is shown
     * only when its target is in this set — a relation to a collection the
     * workspace can't access is hidden (you couldn't pick its records anyway).
     * Undefined = unrestricted (show every relation).
     */
    availableTypeNames?: readonly string[];
    /**
     * BCP-47 tag of the locale a translation prefill copied this form's
     * **shared** values from — set only on a create seeded that way.
     *
     * The shared fields are, at that moment, verbatim text in another language
     * about to be served under this row's locale (WCAG 3.1.2 — `ORT-87`).
     */
    prefilledFromLocale?: string;
    /**
     * The presave contributions' opaque handles, keyed by item id — passed
     * straight through to a contributed tab, which reads only its own key. The
     * handles come from hooks mounted by `ContentEntryView`, so the state behind
     * them (staged media uploads) survives switching tab.
     */
    presave?: Record<string, unknown>;
    /**
     * Whether a presave contribution is holding staged state that this record's
     * next Save will write — an audience edited on the Access tab, say.
     *
     * It is **not** part of `isDirty` below, and the difference is deliberate:
     * `isDirty` means "the form holds unsaved values", which is what the locale
     * switch and the navigation guard ask about. This means "pressing Publish
     * will append a version", which is what a publish guard has to be told, and
     * the two came apart the moment a plugin could stage something the form
     * never sees.
     */
    extensionsStaged?: boolean;
    /**
     * The open tab, owned by the **route** (`/…/:entryId/relations`) rather than
     * by this component — so it survives the remount a locale switch causes.
     */
    tab: string;
    /** Navigate to another tab (the caller pushes the route). */
    onTabChange: (next: string) => void;
}) {
    const intl = useIntl();
    // Whether this reader may write the record at all. A create form needs
    // `content:create`, an existing record `content:update` — the same
    // permissions the server's `@RequirePermissions` enforces on the endpoints
    // this form posts to, so the UI offers exactly what the API will accept.
    //
    // Without it the whole editor renders as a **preview**: `EntryActions`
    // already hides Save/Publish/Delete, but the fields themselves used to stay
    // live, so a reader could retitle a page, recolor it, stage an upload — and
    // only learn at Save that none of it was theirs to change. Read-only is
    // therefore a property of the *form*, not just of its buttons.
    const canWrite = useHasPermission(
        isCreate ? CONTENT_CREATE : CONTENT_UPDATE
    );
    const readOnly = !canWrite;
    // Slot-contributed title-row add-ons (e.g. the i18n plugin's locale chip),
    // rendered beside the heading with the surrounding editor's context.
    const slotContext = useEntrySlotContext();
    const headerItems = ENTRY_HEADER_SLOT.getItems();
    // The existing entry's id, or undefined while creating. Many/inverse
    // relations are staged locally either way and sent as a delta on Save.
    const entryId = entry?.id;
    // First page + total per relation field, for the header counts, to title
    // single relations, and to power the required-relation publish gate. Enabled
    // as soon as there's an existing entry — one request per entry open — rather
    // than waiting for the Relations tab: otherwise a populated relation flashes
    // count 0 on first tab open (#6), and the gate can't see the link counts to
    // flag an empty required relation (#1). Create mode has no server set, so the
    // query stays disabled there.
    const relationsQuery = useEntryRelations(schema.name, entryId, !!entryId);
    const relationRefs = relationsQuery.data;
    // True only while the first load is genuinely in flight (never when disabled
    // in create mode) — drives a neutral count affordance instead of a wrong 0.
    const relationsLoading = relationsQuery.isLoading;
    // Per-field staged relation edits (many/inverse), owned here so they survive
    // collapsing a section or switching tabs, and sent as `relations` deltas on
    // Save. Cleared after a successful save.
    const [relationDeltas, setRelationDeltas] = useState<
        Record<string, StagedRelation>
    >({});
    const stagedFor = (name: string): StagedRelation =>
        relationDeltas[name] ?? EMPTY_STAGED;
    const setStaged = (name: string, next: StagedRelation) =>
        setRelationDeltas((current) => ({ ...current, [name]: next }));

    // A scalar/single field is dirty when its value differs from the seed; a
    // many/inverse field is dirty when its staging holds any pending change.
    //
    // Against **the form's own seed**, not the `initialValues` prop. The two
    // part company exactly when a re-seed has been refused (`ORT-230`): the
    // prop is then the record as the server now holds it — a colleague's save —
    // while the seed is what this author started from. Measured against the
    // prop, every field the colleague touched reads as this author's edit, so
    // the shared-field confirmation named fields nobody here had typed in.
    //
    // `isDirty` below still reads true after a refusal, because the edit that
    // caused the refusal is an edit against the seed too — which is what keeps
    // the unsaved-changes guard armed, the half of `ORT-230` that matters most.
    const isFieldDirty = (name: string) =>
        norm(form.values[name]) !== norm(form.seedValues[name]);
    const isRelationDirty = (name: string) => isStagedDirty(stagedFor(name));

    // Relation fields hidden because their target collection isn't granted to the
    // open workspace: their records aren't reachable here, so the editor doesn't
    // render them (see `relationFields`). They must also be excluded from client
    // validation and the publish gate — otherwise a *required* one is an
    // un-satisfiable, invisible block that pins the form shut with no way to fill
    // it. `undefined` availableTypeNames means unrestricted (nothing hidden).
    const ignoredFields = useMemo(() => {
        const names = new Set<string>();
        if (!availableTypeNames) return names;
        for (const field of schema.fields) {
            if (isHidden(field)) continue;
            if (field.type !== CONTENT_FIELD_TYPE.Relation) continue;
            if (!availableTypeNames.includes(field.relation?.to ?? ''))
                names.add(field.name);
        }
        return names;
    }, [schema, availableTypeNames]);

    // Many/inverse relations are link-managed (staged as deltas), so their key
    // is dropped from the form values (see `seedRelationValues`). They must be
    // excluded from values-based validation and the publish gate too — otherwise
    // a *required* one is a permanent, un-fillable block even though the user has
    // staged links for it. They still render in the Relations tab (via
    // `relationFields`, which keys off `ignoredFields` only).
    const managedRelationNames = useMemo(() => {
        const names = new Set<string>();
        for (const field of schema.fields) {
            if (
                field.type === CONTENT_FIELD_TYPE.Relation &&
                (field.relation?.many || field.relation?.inverse)
            )
                names.add(field.name);
        }
        return names;
    }, [schema]);

    // Fields the schema marks `admin.hidden`. The editor renders no control for
    // them, so a *required* one used to pin the form shut: the publish gate is
    // built from `visible` and therefore read "ready", while validation still
    // counted the field and the toast named it — two surfaces flatly
    // contradicting each other over a control that exists nowhere on screen.
    // Excluding them here is the same rule the ungranted-relation case above
    // already applies; the server stays the authority and answers with a 422
    // (surfaced by `submitWith`) if the value genuinely was required.
    const hiddenFieldNames = useMemo(() => {
        const names = new Set<string>();
        for (const field of schema.fields)
            if (isHidden(field)) names.add(field.name);
        return names;
    }, [schema]);

    // Fields excluded from client validation + the gate: ungranted relations
    // (hidden) plus every link-managed relation (not a form value) plus every
    // `admin.hidden` field.
    const validationIgnored = useMemo(
        () =>
            new Set([
                ...ignoredFields,
                ...managedRelationNames,
                ...hiddenFieldNames
            ]),
        [ignoredFields, managedRelationNames, hiddenFieldNames]
    );

    const form = useEntryForm(schema, initialValues, {
        ignoreFields: validationIgnored,
        seedKey
    });

    const visible = schema.fields.filter((field) => !isHidden(field));
    // Media fields render on their own contributed tab (media-admin's Media
    // tab), not inline in General — so exclude both relations and media here.
    const generalFields = visible.filter(
        (field) =>
            field.type !== CONTENT_FIELD_TYPE.Relation &&
            field.type !== CONTENT_FIELD_TYPE.Media
    );
    const relationFields = visible.filter(
        (field) =>
            field.type === CONTENT_FIELD_TYPE.Relation &&
            !ignoredFields.has(field.name)
    );
    // Every field with a control somewhere in this editor — General, the Media
    // tab, or Relations. A server issue naming anything else has nowhere inline
    // to land, so `submitWith` promotes it to a toast rather than dropping it.
    const renderedFieldNames = new Set(
        visible
            .filter((field) => !ignoredFields.has(field.name))
            .map((field) => field.name)
    );

    // Contributed editor tabs (e.g. media-admin's Media tab), applicable to this
    // type, ordered. Rendered between the built-in Relations and History tabs.
    const tabItems = useMemo(
        () =>
            ENTRY_TAB_SLOT.getItems()
                .filter((item) => item.appliesTo(schema))
                // The tab slugs the router knows are a **closed set**
                // (`ENTRY_TAB_SLUGS`) — a contribution naming anything else
                // renders a trigger whose segment `entryTabFromPath` can't
                // resolve, so clicking it navigates and then shows *General*
                // under a URL that says otherwise, with the contributed tab
                // never selected. Drop it (loudly, in dev) rather than shipping
                // a tab that cannot be opened.
                .filter((item) => {
                    const known = ENTRY_TAB_SLUGS.some(
                        (slug) => slug === item.slug
                    );
                    if (!known)
                        console.error(
                            `[content-admin] ENTRY_TAB_SLOT item "${item.id}" declares slug "${item.slug}", which is not one of ${ENTRY_TAB_SLUGS.join(', ')}. The tab is not rendered, because no route can select it.`
                        );
                    return known;
                })
                .sort((a, b) => a.order - b.order),
        [schema]
    );
    // The saved entry's media fields resolved to refs (thumbnails/names), for
    // any media tab. One request per entry open; disabled in create mode.
    const mediaQuery = useEntryMedia(schema.name, entryId, !!entryId);
    const mediaRefs = mediaQuery.data ?? {};
    // Only *pending* counts as "wait": a failed read must resolve to "nothing
    // here" so a contributed tab falls back instead of waiting forever.
    const mediaRefsPending = mediaQuery.isPending && !!entryId;

    // The context a contributed tab renders with — the slot context plus a form
    // bridge, so a tab's controls read and write the editor's shared form (a
    // media field edited on the Media tab rides Save / the gate / the 422
    // mapping exactly like a General field). Undefined until the slot context is
    // ready (mirrors the header slot's guard).
    const tabContext: EntryTabContext | undefined = slotContext
        ? {
              ...slotContext,
              form: {
                  values: form.values,
                  errorFor: form.errorFor,
                  setValue: form.setValue,
                  touch: form.touch,
                  isFieldDirty
              },
              mediaRefs,
              mediaRefsPending,
              presave: presave ?? {},
              readOnly
          }
        : undefined;

    // The publish gate: each field that must hold to publish — every required
    // field, plus any field whose current value is invalid — with its live
    // pass/fail. Reuses the form's strict (required-enforced) errors, so it
    // mirrors exactly what the publish endpoint will check without re-running
    // validation over the same values. Publishable only.
    const fieldGate = useMemo<PublishGateItem[]>(() => {
        return visible
            .filter((field) => !validationIgnored.has(field.name))
            .filter((field) => field.required || form.errors[field.name])
            .map((field) => ({
                label: fieldLabel(field),
                ok: !form.errors[field.name],
                message: form.errors[field.name]
            }));
    }, [form.errors, visible, validationIgnored]);

    // A **required** many/inverse relation is link-managed, so it never appears
    // in the values bag `validateEntryValues` (and `fieldGate`) checks — the
    // `validationIgnored` skip there is correct and stays. But the server rejects
    // publishing a required relation with zero links, so mirror that here from
    // the counts we do have: the loaded server total ± the staged add/remove.
    // This surfaces the block in the publish gate before the server 422, exactly
    // like a required scalar field (#1).
    const relationGate = useMemo<PublishGateItem[]>(() => {
        const out: PublishGateItem[] = [];
        for (const field of visible) {
            if (field.type !== CONTENT_FIELD_TYPE.Relation) continue;
            if (!field.required) continue;
            // Only link-managed (many/inverse) relations that are actually shown:
            // single relations are gated through their form value, and
            // hidden/ungranted ones must never become an invisible block.
            if (!managedRelationNames.has(field.name)) continue;
            if (ignoredFields.has(field.name)) continue;
            // Inline the staged lookup (not `stagedFor`) so this memo depends on
            // `relationDeltas` directly, not a per-render helper.
            const staged = relationDeltas[field.name] ?? EMPTY_STAGED;
            const serverTotal = relationRefs?.[field.name]?.total;
            // On an existing entry the aggregate may still be loading — we can't
            // assert an empty set yet, so skip rather than raise a false failure.
            // Create mode has no server set (total 0), so the staged adds decide.
            if (entryId && serverTotal === undefined) continue;
            const count = Math.max(
                0,
                (serverTotal ?? 0) - staged.removed.length + staged.added.length
            );
            out.push({
                label: fieldLabel(field),
                ok: count > 0,
                message:
                    count > 0
                        ? undefined
                        : intl.formatMessage(messages.relationRequired)
            });
        }
        return out;
    }, [
        visible,
        managedRelationNames,
        ignoredFields,
        relationDeltas,
        relationRefs,
        entryId,
        intl
    ]);

    // The full gate shown in the rail: the values-bag checks plus the
    // count-based required-relation checks.
    const gate = useMemo<PublishGateItem[]>(
        () => [...fieldGate, ...relationGate],
        [fieldGate, relationGate]
    );

    // Which tabs still hold something that blocks publishing — what the tab bar
    // marks with an asterisk. A set, not a tally: the marker says *that* a tab
    // has outstanding fields, and the rail's gate beside it is where they are
    // named, since the gate lists precisely the failing checks.
    //
    // Same rule as `fieldGate`, resolved to a tab instead of a label: a field
    // counts when the strict (required-enforced) errors name it, which is
    // exactly the set the rail lists as failing. Reading `form.errors` rather
    // than the gate keeps the field in hand, and the field is what knows its
    // tab; the gate items are already flattened to labels by then.
    //
    // `form.errors` is live and ungated by `submitted`, so a new entry shows
    // its markers from the moment it opens. That is deliberate and matches the
    // rail beside it, whose gate lists the same unmet fields before the first
    // save — the marker says "this is what publishing still wants", not "you
    // got something wrong just now".
    const unmetTabs = useMemo<Set<string>>(() => {
        const slugs = new Set<string>();
        for (const field of visible) {
            if (validationIgnored.has(field.name)) continue;
            if (!form.errors[field.name]) continue;
            slugs.add(entryTabForField(field));
        }
        // The link-managed required relations, which never reach the values bag
        // and so are missing from `form.errors` entirely. `relationGate` has
        // already done that work; every item in it is a relation, so every
        // failure belongs to the Relations tab.
        if (relationGate.some((item) => !item.ok)) {
            slugs.add(ENTRY_TAB.Relations);
        }
        return slugs;
    }, [form.errors, visible, validationIgnored, relationGate]);

    // Whether anything at all is unsaved — a dirty field value or staged
    // relation links. Handed to slot widgets so a locale switch can confirm
    // before discarding the work instead of dropping it silently (#36), to the
    // publish guards (a save moves the version an approval is bound to), and to
    // the save itself (an unchanged record publishes without one).
    const isDirty =
        visible.some((field) => isFieldDirty(field.name)) ||
        Object.values(relationDeltas).some(isStagedDirty);

    // What a press of Publish will actually **ship**, which is not the same
    // question as whether the form is dirty. Publish saves first when there is
    // anything to save, and a save appends a revision — so with a staged
    // audience and untouched fields, judging the stored head would offer an
    // ordinary publish for a version that is about to stop being the head. The
    // approvals bound to it stop counting at that moment and the API answers
    // 409, which is the one outcome a publish guard exists to prevent.
    const willWriteVersion = isDirty || extensionsStaged === true;

    // The staged relation deltas to send with the save — only fields with a
    // pending change, serialized to the wire shape. Undefined when nothing staged.
    const relationsPayload = (): Record<string, RelationDelta> | undefined => {
        const out: Record<string, RelationDelta> = {};
        for (const [name, staged] of Object.entries(relationDeltas)) {
            if (isStagedDirty(staged)) out[name] = stagedToWire(staged);
        }
        return Object.keys(out).length ? out : undefined;
    };

    // A 422 from the server is mapped back onto the form as inline field errors;
    // other failures fall through to the mutation's own error handling. On
    // success the staging is cleared (the saved links are now the server set).
    const submitWith =
        (publish: boolean, options: EntryPublishOptions = {}) =>
        (values: Record<string, unknown>) =>
            onSave(values, {
                publish,
                relations: relationsPayload(),
                ignoreFields: validationIgnored,
                dirty: isDirty,
                bypass: options.bypass,
                // Re-arm seeding the moment a write lands. The response is what
                // the editor then shows, and it reaches the form as a **new
                // seed** — `useSaveEntry` primes the read-one cache with it
                // inside `onSuccess` — which the form has by then refused,
                // because the form is dirty and it is our own edits that made
                // it so. Without re-arming, a save that worked leaves the
                // editor dirty forever: the conflict banner sits there
                // accusing the author of their own write, and the
                // unsaved-changes guard keeps prompting on a saved record.
                //
                // It hangs off the write rather than this promise's `.then()`
                // because a **landed save whose chained publish is refused**
                // rejects — protection's 409, the server gate's 422 — and takes
                // the `.catch()` branch below with a record already written.
                // Only the flow can tell that from a save that never landed,
                // and adopting the seed on a save that never landed would
                // replace the author's values with the server's on a plain
                // validation error.
                onWriteLanded: () => form.acceptSeed()
            })
                .then(() => setRelationDeltas({}))
                .catch((error) => {
                    const issues = entryIssuesFrom(error);
                    form.setServerErrors(issues);
                    // Not a field problem at all — a publish guard's refusal, a
                    // conflict, a lost connection. Without this the cover lifts
                    // and nothing on screen says the write did not happen.
                    if (issues.length === 0) {
                        const message = serverMessage(error);
                        toast.error(
                            message
                                ? intl.formatMessage(
                                      publish && publishable
                                          ? messages.publishRefused
                                          : messages.saveRefused,
                                      { message }
                                  )
                                : intl.formatMessage(messages.writeFailed)
                        );
                        return;
                    }
                    // An issue on a field the editor renders no control for
                    // (`admin.hidden`, or a relation target this workspace
                    // isn't granted) has nowhere inline to land, so the busy
                    // cover would simply lift and nothing would appear. Say it
                    // in a toast instead — the same shape `announceBlocked`
                    // uses for the client-side refusal.
                    const orphan = issues.find(
                        (issue) => !renderedFieldNames.has(issue.field)
                    );
                    if (orphan)
                        toast.error(
                            intl.formatMessage(messages.serverBlocked, {
                                field: orphan.field,
                                message: orphan.message
                            })
                        );
                });

    // A **draft** of a publishable type can be saved incomplete, so it uses the
    // relaxed (format-only) gate — required isn't enforced, but a malformed value
    // is still caught client-side. Publishing — or any save of an always-live,
    // non-publishable type — enforces the full rules before submitting.
    // A submit the client rules refused reveals the inline field errors — but
    // those can sit on a tab the user isn't looking at (or below the fold), so
    // the button reads as dead: pressed, nothing happened, nothing explained
    // (#10, #28). Announce it in a toast naming the first offending field, and
    // move to the tab that field lives on so the marked control is on screen.
    const announceBlocked = (strict: boolean, publish: boolean) => {
        const blocking = strict ? form.errors : form.draftErrors;
        const names = Object.keys(blocking);
        if (names.length === 0) return;
        const first =
            visible.find((field) => blocking[field.name]) ??
            schema.fields.find((field) => blocking[field.name]);
        // Through the shared mapping, so the tab this jumps to is always the
        // tab the bar just marked.
        onTabChange(first ? entryTabForField(first) : ENTRY_TAB.General);
        toast.error(
            intl.formatMessage(
                publish ? messages.publishBlocked : messages.saveBlocked,
                {
                    count: names.length,
                    field: first ? fieldLabel(first) : names[0]
                }
            )
        );
        // The toast says "start with X"; without this the user has to *find* X
        // by hand — Shift+Tab out of the top bar, past the breadcrumb, into a
        // panel that may have just been swapped underneath them. Move focus
        // there instead. Deferred one frame because the tab switch above is a
        // route change: the destination control does not exist yet in this tick.
        // `EntryFieldInput` ids every control `entry-field-<name>`; a relation
        // or media field has no such control, so nothing is focused and the
        // toast remains the only cue — the same as before this change.
        const focusName = first?.name ?? names[0];
        requestAnimationFrame(() => {
            document.getElementById(`entry-field-${focusName}`)?.focus();
        });
    };

    /**
     * Take the record as the server now holds it, dropping this author's
     * unsaved field edits — the conflict notice's way out.
     *
     * The control that runs this **unmounts with the notice** on the very next
     * render, so focus would be left on `<body>`: React and Radix alike can
     * only restore onto a node that still exists, which is why this package
     * already puts focus back by hand after the saved-view delete dialog and
     * after `onRowGone` in the records table. Here the right landing place is
     * the form itself — its values have just changed under the reader, and the
     * first field announces the new one as it takes focus. Deferred a frame
     * because the notice is still mounted in this tick; a type whose fields all
     * render through a contributed control that puts the id elsewhere focuses
     * nothing, which is no worse than the fall-through it replaces.
     */
    const reloadFromServer = () => {
        form.acceptSeed();
        requestAnimationFrame(() => {
            for (const field of generalFields) {
                const control = document.getElementById(
                    `entry-field-${field.name}`
                );
                if (control) {
                    control.focus();
                    return;
                }
            }
        });
    };

    const runSave = (publish: boolean, options?: EntryPublishOptions) => {
        // A reader without write permission has no Save button, but the form's
        // own `onSubmit` (Enter in a text field) is a second way in — so the
        // guard lives here, at the one point every save path funnels through,
        // rather than only on the controls that call it.
        if (readOnly) return;
        // A **draft** of a publishable type can be saved incomplete (relaxed
        // gate); publishing — or any save of an always-live type — is strict.
        const strict = publish || !publishable;
        const submitted = strict
            ? form.submit(submitWith(publish, options))
            : form.submitDraft(submitWith(publish, options));
        if (!submitted) announceBlocked(strict, publish);
    };

    // Shared (non-localized) fields are **synced across the translation group**
    // on save — the server copies them to every sibling row in the same
    // transaction. That is invisible from an editor scoped to one locale, so a
    // save that carries such a change confirms first (#17). Only ever relevant
    // on a type that *has* both kinds of field; a plain type has no siblings to
    // affect and never sees this.
    // Every non-relation field (General **and** Media) that's shared and dirty —
    // a media field syncs to siblings the same as a scalar, so it belongs here.
    const dirtySharedFields = visible.filter(
        (field) =>
            field.type !== CONTENT_FIELD_TYPE.Relation &&
            !field.localized &&
            isFieldDirty(field.name)
    );
    const hasLocalizedFields = visible.some((field) => field.localized);
    const needsSharedWarning =
        hasLocalizedFields && !isCreate && dirtySharedFields.length > 0;

    // The save the shared-fields warning is holding, with whatever the publish
    // carried — a bypass confirmed before the warning must survive it.
    const [pendingPublish, setPendingPublish] = useState<{
        publish: boolean;
        options?: EntryPublishOptions;
    } | null>(null);

    // --- the expanded field ------------------------------------------------
    // A control whose slot item declares a `FullView` can take the work area
    // over (the WYSIWYG editor does). The state lives here because this is the
    // component that acts on it — it swaps the tab strip for that view — while
    // the chrome around it (sidebar, top-bar actions, Properties rail) is
    // untouched, since all of it renders from this same still-mounted form.
    const [expandedFieldName, setExpandedFieldName] = useState<string | null>(
        null
    );
    const expandedField = generalFields.find(
        (field) => field.name === expandedFieldName
    );
    const expandedItem = expandedField
        ? ENTRY_FIELD_CONTROL_SLOT.getItems().find((item) =>
              item.appliesTo(expandedField)
          )
        : undefined;
    const ExpandedView = expandedItem?.FullView;
    // Resolution can fail after the fact — a locale switch can bring a schema
    // whose field set no longer has this one. Falling back to the tabs already
    // happens (there is nothing to render), so this just stops the name from
    // lingering as a phantom the next control would compare itself against.
    useEffect(() => {
        if (expandedFieldName && !ExpandedView) setExpandedFieldName(null);
    }, [expandedFieldName, ExpandedView]);

    /** What the expanded view renders with — the control context, minus the
     * form-row wiring that only exists inside `EntryFieldInput`. `describedBy`
     * is deliberately absent: the `<FieldError>` it would point at belongs to
     * the field row, which is not on screen, so the expanded view surfaces the
     * `error` itself. */
    const expandedContext: EntryFieldControlContext | undefined = expandedField
        ? {
              field: expandedField,
              id: `entry-field-${expandedField.name}`,
              label: fieldLabel(expandedField),
              value: form.values[expandedField.name],
              error: form.errorFor(expandedField.name),
              readOnly,
              // The form row inherits this from the Translated group's
              // wrapper; an expanded view is rendered outside it, so it is
              // handed the row's locale directly. See the field's JSDoc.
              contentLocale: entry?.locale,
              onChange: (value) => form.setValue(expandedField.name, value),
              onBlur: () => form.touch(expandedField.name),
              expanded: true,
              setExpanded: (next) =>
                  setExpandedFieldName(next ? expandedField.name : null)
          }
        : undefined;

    const save = (publish: boolean, options?: EntryPublishOptions) => {
        if (readOnly) return;
        if (needsSharedWarning) {
            setPendingPublish({ publish, options });
            return;
        }
        runSave(publish, options);
    };

    // Register with the app-wide guard, so *any* navigation away from a dirty
    // editor — a sidebar link, a breadcrumb, "Back to records", a browser
    // reload — confirms first, not just the locale switch. A preview can't be
    // dirty, and prompting a reader to save work they were never able to do
    // would be a dead end with no way out but Discard.
    useUnsavedChanges(isDirty && !readOnly);

    return (
        <EntryReadOnlyProvider value={readOnly}>
            <ExpandedFieldProvider
                value={{
                    name: expandedFieldName,
                    setName: setExpandedFieldName
                }}
            >
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        // Only **this** form's own submit counts.
                        //
                        // A slot-contributed control (the WYSIWYG editor's alt-text
                        // and link popovers, its "from a URL" dialog) renders its
                        // own `<form>` inside a portal. The portal moves it in the
                        // DOM but not in the **React tree**, and React bubbles
                        // synthetic events along that tree — so pressing Save in one
                        // of those popovers arrived here and saved-and-published the
                        // whole record.
                        //
                        // Those overlays stop propagation on their side too, but the
                        // guard belongs here as well: this form is a seam any plugin
                        // can render into, and it should not act on a submit it
                        // didn't raise.
                        if (event.target !== event.currentTarget) return;
                        // Submitting (e.g. Enter) runs the primary action — publish for
                        // a publishable type, otherwise a plain save — so it matches the
                        // visually-primary button rather than silently saving a draft.
                        save(publishable);
                    }}
                >
                    {/* The write actions and the Properties panel render in the **app
                chrome** — the top bar's actions region and the shell's right
                panel — not in this form. Both go through a portal rather than
                being handed to the shell as nodes, which is what keeps them in
                this React tree: they read the editor's handlers and busy state,
                the entry slot context, and the open workspace, none of which
                exist at the shell's position. */}
                    <PageActionsPortal>
                        <EntryActions
                            entry={entry}
                            publishable={publishable}
                            paranoid={schema.paranoid ?? false}
                            isCreate={isCreate}
                            saving={saving}
                            mutating={mutating}
                            dirty={willWriteVersion}
                            onSaveDraft={() => save(false)}
                            onPublish={(options) => save(true, options)}
                            onUnpublish={onUnpublish}
                            onDelete={onDelete}
                        />
                    </PageActionsPortal>

                    <RightPanelPortal
                        title={intl.formatMessage(messages.propertiesPanel)}
                    >
                        <EntrySidebar
                            entry={entry}
                            publishable={publishable}
                            isCreate={isCreate}
                            gate={gate}
                        />
                    </RightPanelPortal>

                    {/* Main column: title + tabs. The card itself is flush (no padding);
                padding lives here, inside the pane. `min-w-0` keeps wide field
                content from widening the page (the card scrolls as a whole). */}
                    <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
                        {/* Centered reading column: the editor content is capped and
                    centered instead of stretching the full pane width. An
                    expanded field gets a wider column and the pane's remaining
                    height — a rich-text body read through a form-width column
                    is the cramped thing the expansion exists to fix. */}
                        <div
                            className={cn(
                                'mx-auto w-full',
                                expandedContext
                                    ? 'flex min-h-0 max-w-6xl flex-1 flex-col'
                                    : 'max-w-3xl'
                            )}
                        >
                            {/* The record-level back link steps out of the record; the
                        expanded view's own back button steps back to the
                        fields. Showing both would stack two back arrows with
                        different destinations, so only one is on screen at a
                        time. */}
                            {backTo && !expandedContext ? (
                                <Link
                                    to={backTo}
                                    className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <ArrowLeft className="size-4" />
                                    {intl.formatMessage(messages.backToList)}
                                </Link>
                            ) : null}
                            {/* The shared page header, not a hand-rolled one.
                                This heading had drifted to its own size and
                                tracking, so the record page and every other
                                page in the admin titled themselves
                                differently — and would have again on the next
                                change to either.

                                `ENTRY_HEADER_SLOT` items ride the `actions`
                                region: they are marks *about* the record (the
                                current locale, a restricted chip), and the
                                header already keeps them on the title's row
                                while leaving the `<h1>` the sole heading. */}
                            <ContainerHeader
                                className="mb-6 min-w-0"
                                icon={<FileText className="size-4" />}
                                title={title}
                                subtitle={subtitle}
                                actions={
                                    // An empty array is truthy, and the header
                                    // draws its actions row for anything
                                    // truthy — so a record with no
                                    // contributions has to hand it `undefined`
                                    // rather than `[]`.
                                    slotContext && headerItems.length > 0
                                        ? headerItems.map((item) => (
                                              <item.Component
                                                  key={item.id}
                                                  {...slotContext}
                                              />
                                          ))
                                        : undefined
                                }
                            />

                            {readOnly ? <ReadOnlyNotice /> : null}

                            {/* The record changed underneath this form and the
                                incoming values were refused rather than seeded
                                over the author's. Under the title, beside the
                                read-only banner, and deliberately **not** in
                                the Properties rail: that column collapses, and
                                a notice you can hide is not a notice. It is not
                                routed through the view's error card either — a
                                refusal, an absence and a failure are three
                                different states (`content:I-40`). Read-only
                                inherits the same condition as every other write
                                affordance (`content:I-39`), though a form no
                                one can type into cannot reach this anyway. */}
                            {!readOnly && form.seedRefused ? (
                                <EntryChangedNotice
                                    onDiscard={reloadFromServer}
                                />
                            ) : null}

                            {ExpandedView && expandedContext ? (
                                <ExpandedView {...expandedContext} />
                            ) : (
                                <div className="min-w-0">
                                    <Tabs
                                        value={tab}
                                        onValueChange={onTabChange}
                                    >
                                        <TabsList className="mb-4">
                                            <TabsTrigger
                                                value={ENTRY_TAB.General}
                                            >
                                                {intl.formatMessage(
                                                    messages.tabGeneral
                                                )}
                                                <EntryTabIssues
                                                    unmet={unmetTabs.has(
                                                        ENTRY_TAB.General
                                                    )}
                                                />
                                            </TabsTrigger>
                                            <TabsTrigger
                                                value={ENTRY_TAB.Relations}
                                            >
                                                {intl.formatMessage(
                                                    messages.tabRelations
                                                )}
                                                <EntryTabIssues
                                                    unmet={unmetTabs.has(
                                                        ENTRY_TAB.Relations
                                                    )}
                                                />
                                            </TabsTrigger>
                                            {tabItems.map((item) => (
                                                <TabsTrigger
                                                    key={item.id}
                                                    value={item.slug}
                                                >
                                                    {intl.formatMessage(
                                                        item.label
                                                    )}
                                                    <EntryTabIssues
                                                        unmet={unmetTabs.has(
                                                            item.slug
                                                        )}
                                                    />
                                                </TabsTrigger>
                                            ))}
                                            <TabsTrigger
                                                value={ENTRY_TAB.History}
                                            >
                                                {intl.formatMessage(
                                                    messages.tabHistory
                                                )}
                                            </TabsTrigger>
                                        </TabsList>

                                        <TabsContent value={ENTRY_TAB.General}>
                                            <EntryFieldSections
                                                fields={generalFields}
                                                form={form}
                                                isChanged={isFieldDirty}
                                                contentLocale={entry?.locale}
                                                {...(prefilledFromLocale
                                                    ? {
                                                          prefilledFromLocale
                                                      }
                                                    : {})}
                                            />
                                        </TabsContent>

                                        <TabsContent
                                            value={ENTRY_TAB.Relations}
                                        >
                                            {relationFields.length > 0 ? (
                                                <div className="flex flex-col gap-3">
                                                    <p className="text-sm text-muted-foreground">
                                                        {intl.formatMessage(
                                                            messages.relationsSubtitle
                                                        )}
                                                    </p>
                                                    {relationFields.map(
                                                        (field) => {
                                                            // A many/inverse relation is staged +
                                                            // link-managed; a single relation is a
                                                            // plain form value.
                                                            const managed =
                                                                !!field.relation
                                                                    ?.many ||
                                                                !!field.relation
                                                                    ?.inverse;
                                                            const staged =
                                                                stagedFor(
                                                                    field.name
                                                                );
                                                            // Header count: server total adjusted by
                                                            // the staged add/remove (managed), else
                                                            // the single form value's length. `null`
                                                            // while the managed set's aggregate is
                                                            // still loading, so the header shows a
                                                            // neutral affordance rather than a wrong
                                                            // 0 for a populated relation (#6).
                                                            const count:
                                                                | number
                                                                | null = managed
                                                                ? relationsLoading
                                                                    ? null
                                                                    : Math.max(
                                                                          0,
                                                                          (relationRefs?.[
                                                                              field
                                                                                  .name
                                                                          ]
                                                                              ?.total ??
                                                                              0) -
                                                                              staged
                                                                                  .removed
                                                                                  .length +
                                                                              staged
                                                                                  .added
                                                                                  .length
                                                                      )
                                                                : toRelationIds(
                                                                      form
                                                                          .values[
                                                                          field
                                                                              .name
                                                                      ],
                                                                      false
                                                                  ).length;
                                                            const changed =
                                                                managed
                                                                    ? isRelationDirty(
                                                                          field.name
                                                                      )
                                                                    : isFieldDirty(
                                                                          field.name
                                                                      );
                                                            return (
                                                                <RelationFieldSection
                                                                    key={
                                                                        field.name
                                                                    }
                                                                    field={
                                                                        field
                                                                    }
                                                                    count={
                                                                        count
                                                                    }
                                                                    changed={
                                                                        changed
                                                                    }
                                                                    typeName={
                                                                        schema.name
                                                                    }
                                                                    entryId={
                                                                        entryId
                                                                    }
                                                                    value={
                                                                        form
                                                                            .values[
                                                                            field
                                                                                .name
                                                                        ]
                                                                    }
                                                                    error={form.errorFor(
                                                                        field.name
                                                                    )}
                                                                    onChange={(
                                                                        value
                                                                    ) =>
                                                                        form.setValue(
                                                                            field.name,
                                                                            value
                                                                        )
                                                                    }
                                                                    onBlur={() =>
                                                                        form.touch(
                                                                            field.name
                                                                        )
                                                                    }
                                                                    initialRefs={
                                                                        relationRefs?.[
                                                                            field
                                                                                .name
                                                                        ]?.items
                                                                    }
                                                                    staged={
                                                                        staged
                                                                    }
                                                                    onStagedChange={(
                                                                        next
                                                                    ) =>
                                                                        setStaged(
                                                                            field.name,
                                                                            next
                                                                        )
                                                                    }
                                                                />
                                                            );
                                                        }
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">
                                                    {intl.formatMessage(
                                                        messages.relationsEmpty
                                                    )}
                                                </p>
                                            )}
                                        </TabsContent>

                                        {tabContext
                                            ? tabItems.map((item) => (
                                                  <TabsContent
                                                      key={item.id}
                                                      value={item.slug}
                                                  >
                                                      <item.Component
                                                          {...tabContext}
                                                      />
                                                  </TabsContent>
                                              ))
                                            : null}

                                        <TabsContent value={ENTRY_TAB.History}>
                                            <HistoryTimeline
                                                typeName={schema.name}
                                                entryId={entry?.id}
                                                schema={schema}
                                            />
                                        </TabsContent>
                                    </Tabs>
                                </div>
                            )}
                        </div>
                    </div>

                    <ConfirmDialog
                        open={pendingPublish !== null}
                        onOpenChange={(open) => {
                            if (!open) setPendingPublish(null);
                        }}
                        title={intl.formatMessage(messages.sharedSaveTitle)}
                        description={intl.formatMessage(
                            messages.sharedSaveBody,
                            {
                                count: dirtySharedFields.length,
                                first: dirtySharedFields[0]
                                    ? fieldLabel(dirtySharedFields[0])
                                    : ''
                            }
                        )}
                        confirmLabel={intl.formatMessage(
                            messages.sharedSaveConfirm
                        )}
                        cancelLabel={intl.formatMessage(messages.cancel)}
                        onConfirm={() => {
                            const pending = pendingPublish;
                            setPendingPublish(null);
                            if (pending)
                                runSave(pending.publish, pending.options);
                        }}
                    />
                </form>
            </ExpandedFieldProvider>
        </EntryReadOnlyProvider>
    );
}
