import { defineMessages, useIntl } from 'react-intl';
import {
    CONTENT_FIELD_TYPE,
    type EntryTabContext
} from '@orthacms/content-admin';
import { MEDIA_PRESAVE_ID } from '../../hooks/usePendingMediaUploads';
import type { MediaPendingUploads } from '../../types/pendingUpload';
import { MediaFieldSection } from './MediaFieldSection';

const messages = defineMessages({
    subtitle: {
        id: 'media.tab.subtitle',
        defaultMessage:
            'Attach images and files from the Media Library, or upload new ones — uploads are added to the library too.'
    }
});

/**
 * The entry editor's **Media tab**, contributed by the media plugin through
 * content-admin's `ENTRY_TAB_SLOT`. Renders one {@link MediaFieldSection} per
 * media field on the type — the same titled-card shape the Relations tab uses —
 * bound to the editor's shared form, so a change here rides Save, the publish
 * gate, and the 422→field mapping exactly like a General-tab field. Media values
 * live in the entry `values` bag; this tab is only their rendering surface.
 */
export function EntryMediaTab(ctx: EntryTabContext) {
    const intl = useIntl();
    const { schema, form, mediaRefs, mediaRefsPending, readOnly } = ctx;
    // The plugin's own presave handle — the staging for files chosen here, held
    // above this panel (which unmounts on every tab switch) and uploaded by the
    // save. A tab reads only its own key from `presave`.
    const uploads = ctx.presave[MEDIA_PRESAVE_ID] as
        | MediaPendingUploads
        | undefined;
    const fields = schema.fields.filter(
        (field) => field.type === CONTENT_FIELD_TYPE.Media
    );

    if (fields.length === 0) return null;

    return (
        <div className="flex flex-col gap-4">
            {/* The subtitle is an instruction for attaching and uploading, so
                it has nothing to tell a reader who can do neither. The editor's
                own read-only banner has already said why. */}
            {readOnly ? null : (
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.subtitle)}
                </p>
            )}
            {fields.map((field) => (
                <MediaFieldSection
                    key={field.name}
                    field={field}
                    error={form.errorFor(field.name)}
                    changed={form.isFieldDirty(field.name)}
                    value={form.values[field.name]}
                    initialRefs={mediaRefs[field.name]}
                    refsPending={mediaRefsPending}
                    uploads={uploads}
                    readOnly={readOnly}
                    onChange={(value) => form.setValue(field.name, value)}
                    onBlur={() => form.touch(field.name)}
                />
            ))}
        </div>
    );
}
