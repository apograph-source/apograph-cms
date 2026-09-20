import { defineMessages, useIntl } from 'react-intl';
import { Badge } from '@orthacms/design-system';
import { MEDIA_KIND, type MediaKind } from '../../constants';
import { MediaKindIcon } from '../MediaKindIcon';

/** Intl descriptors for the asset-kind labels, co-located. */
const messages = defineMessages({
    image: { id: 'media.kind.image', defaultMessage: 'Image' },
    video: { id: 'media.kind.video', defaultMessage: 'Video' },
    audio: { id: 'media.kind.audio', defaultMessage: 'Audio' },
    document: { id: 'media.kind.document', defaultMessage: 'Document' },
    archive: { id: 'media.kind.archive', defaultMessage: 'Archive' }
});

/** Maps each kind to its label descriptor. */
const KIND_LABEL = {
    [MEDIA_KIND.Image]: messages.image,
    [MEDIA_KIND.Video]: messages.video,
    [MEDIA_KIND.Audio]: messages.audio,
    [MEDIA_KIND.Document]: messages.document,
    [MEDIA_KIND.Archive]: messages.archive
};

/**
 * A small labelled badge for an asset {@link MediaKind} — a kind glyph beside its
 * localized name. Shared by the list view and the detail drawer so the kind reads
 * the same everywhere.
 */
export function MediaKindBadge({ kind }: { kind: MediaKind }) {
    const intl = useIntl();
    return (
        <Badge variant="secondary" className="font-medium">
            <MediaKindIcon kind={kind} className="size-3" />
            {intl.formatMessage(KIND_LABEL[kind])}
        </Badge>
    );
}
