export { ContentPlugin } from './lib/presentation/contentPlugin';
export type { ContentAdminPlugin } from './lib/presentation/contentPlugin';

export {
    CONTENT_OVERLAY_SLOT,
    ENTRY_DETAILS_ROW_SLOT,
    ENTRY_FIELD_CONTROL_SLOT,
    ENTRY_HEADER_SLOT,
    ENTRY_MENU_SLOT,
    ENTRY_PARAMS_SLOT,
    ENTRY_PRESAVE_SLOT,
    ENTRY_PUBLISH_GUARD_SLOT,
    ENTRY_SIDEBAR_WIDGET_SLOT,
    ENTRY_TAB_SLOT,
    RECORDS_BULK_ACTION_SLOT,
    RECORDS_COLUMN_SLOT,
    RECORDS_MENU_SLOT,
    RECORDS_FILTER_FIELDS_SLOT,
    RECORDS_TOOLBAR_SLOT,
    REVISION_EXTRA_SLOT
} from './lib/presentation/slots/contentSlots';
export type {
    ContentOverlayItem,
    EntryDetailsRowItem,
    EntryFieldControlContext,
    EntryFieldControlItem,
    EntryHeaderItem,
    EntryMenuEntry,
    EntryMenuItem,
    RecordsBulkActionEntry,
    RecordsBulkActionItem,
    RecordsBulkContext,
    RecordsMenuContext,
    RecordsMenuEntry,
    RecordsMenuItem,
    EntryParamsItem,
    EntryPresave,
    EntryPresaveItem,
    EntryPresaveResult,
    EntryPublishAction,
    EntryPublishGuardItem,
    EntryPublishGuardState,
    EntryPublishOptions,
    EntryPublishVerdict,
    EntrySlotContext,
    EntrySidebarWidgetItem,
    EntryTabContext,
    EntryTabForm,
    EntryTabItem,
    RecordsColumnCellContext,
    RecordsColumnItem,
    RecordsFilterFieldsItem,
    RecordsToolbarContext,
    RecordsToolbarItem,
    RevisionExtraItem,
    RevisionExtraValueContext
} from './lib/presentation/slots/contentSlots';

export type {
    ContentField,
    ContentType,
    ContentTypeDetail,
    EntryRecord,
    EntryStatus,
    MediaRef
} from './lib/domain/types/contentType';
export { ENTRY_MODE, type EntryMode } from './lib/domain/constants';
export { CONTENT_FIELD_TYPE, ENTRY_TAB } from './lib/domain/constants';
// Where an `ENTRY_MENU_SLOT` item sits in the editor's ⋯ menu.
export { ENTRY_MENU_GROUP, type EntryMenuGroup } from './lib/domain/constants';
// The stored publish values, so a contributor testing "is this live?" compares
// against the same constants the library does rather than a bare string.
export { ENTRY_STATUS } from './lib/domain/constants';

// The bulk write mutations, exported for a plugin acting on a set of this
// library's records — the i18n plugin unpublishes a record's locale siblings
// with them. They invalidate the same caches the library's own writes do.
export { useBulkEntryActions } from './lib/application/useBulkEntryActions';

// The publish pre-flight, exported so a plugin acting on a *known* set of
// records reuses the dry-run → verdicts → commit dialog instead of building a
// second one (the i18n plugin's "publish all locales"). `labels` + `labelFor`
// are what let it read as something other than a table selection.
export { BulkPublishDialog } from './lib/presentation/components/CollectionRecordsView/BulkPublishDialog';

// The publish-state classification + its one rendering, exported so a plugin
// contributing its own view of an entry (the i18n locale rows and the records
// Locales column) shows the same four states with the same labels and tints —
// rather than re-deriving Published/Draft and losing "Modified".
export {
    entryStatusView,
    ENTRY_STATUS_VIEW,
    ENTRY_STATUS_VIEW_VARIANT,
    type EntryStatusView
} from './lib/domain/entryStatusView';
export {
    EntryStatusBadge,
    ENTRY_STATUS_VIEW_LABEL
} from './lib/presentation/components/EntryStatusBadge';

// The editor's "unsaved edits" pill, exported for the same reason: a plugin
// contributing an entry tab (the media plugin's Media tab) marks a changed field
// with the *same* badge the General and Relations tabs use, instead of a
// look-alike that drifts.
export { ChangedBadge } from './lib/presentation/components/ChangedBadge';

// The entry rail's chrome. The rail is one flat panel of divider-separated
// sections, so a plugin contributing an `ENTRY_SIDEBAR_WIDGET_SLOT` widget
// renders *these* rather than a card of its own — a widget that drew its own
// border and background would be the one floating box left in the panel.
export { EntrySidebarSection } from './lib/presentation/components/EntrySidebarSection';
export { EntrySidebarRow } from './lib/presentation/components/EntrySidebarRow';

// Query-key builders, exported so a slot contributor can invalidate the
// library's caches after its own mutations (e.g. creating a translation).
//
// Prefer `refreshEntryCaches` over hand-rolling the set: the roots are
// `content-entries` / `content-entry` / … and **not** `content`, so the obvious
// `invalidateQueries({ queryKey: ['content'] })` matches nothing at all —
// TanStack compares key segments, and `'content' !== 'content-entries'`. A
// contributor that writes entries (the importer does) gets a silent no-op and a
// list that never refreshes.
export { refreshEntryCaches } from './lib/application/refreshEntryCaches';
export { contentEntriesPrefix } from './lib/application/useContentEntries';
export { contentEntryKey } from './lib/application/useContentEntry';

// The type's filterable surface, exported so a plugin that stores a *saved*
// records filter (the alarms plugin's rules) edits it with the same query
// builder, over the same server-derived paths, as the list it came from. A
// second source of filterable fields is how a saved filter starts meaning
// something the list never meant.
export { useFilterFields } from './lib/application/useFilterFields';
export type { FilterFieldsResult } from './lib/application/useFilterFields';

// The catalogue and one type's schema, for the same reason. A plugin that
// stores a filter has to let someone **choose what to store it against**, and
// `RECORDS_FILTER_FIELDS_SLOT.useFields` takes a `ContentTypeDetail` — so a
// consumer that offers the records list's full filterable surface (rather than
// the server-derived half of it) needs the schema too. Without it a rule saved
// over a slot-contributed field, like i18n's `localeCount`, reads back as
// "this field is no longer available" in the editor that is supposed to edit
// it.
export { useContentTypes } from './lib/application/useContentTypes';
export { useContentSchema } from './lib/application/useContentSchema';

// The `*` a required field's label wears, exported so a plugin's own form uses
// the convention the entry editor established rather than inventing a second
// one. It is `aria-hidden` on purpose — the control carries `aria-required`,
// and marking the asterisk up too announces "required" twice per field. State
// what it means once, in a visible legend above the fields.
export { RequiredMark } from './lib/presentation/components/EntryFieldInput/RequiredMark';

// The record picker a relation-id filter rule needs. The query builder holds no
// data layer, so it takes this through `renderRelationValue` — and a consumer
// that mounts the builder without it gets a *plain text box* where a relation
// rule's value should be, i.e. a rule you can only complete by pasting a uuid.
// Exported so the alarms rule editor offers the same picker the records list
// does rather than that.
export { RelationValuePicker } from './lib/presentation/components/RelationValuePicker';
