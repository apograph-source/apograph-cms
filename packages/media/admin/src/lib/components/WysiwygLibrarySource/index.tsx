import type { WysiwygMediaSourceContext } from '@orthacms/wysiwyg-admin';
import type { MediaAsset } from '../../types/mediaAsset';
import { MediaPickerDialog } from '../MediaPickerDialog';
import { toWysiwygEmbed } from '../../utils/toWysiwygEmbed';

/**
 * The Media Library as a **rich-text media source** — the plugin's contribution
 * to `WYSIWYG_MEDIA_SLOT`.
 *
 * It is the same {@link MediaPickerDialog} a media *field* opens, which is the
 * point: browsing, searching, and folder navigation are one implementation, and
 * an author moving between a media field and a body meets the same picker.
 *
 * `multiple` is on, because placing three images in a row is a normal thing to
 * do in a body and re-opening the picker twice for it is not.
 */
export function WysiwygLibrarySource({
    open,
    onOpenChange,
    accept,
    onInsert
}: WysiwygMediaSourceContext) {
    return (
        <MediaPickerDialog
            open={open}
            onOpenChange={onOpenChange}
            multiple
            // The editor's kinds, handed to the picker as its own restriction —
            // so an audio file or a PDF is filtered out of the grid rather than
            // being pickable and then silently dropped on insert.
            accept={{ kinds: [...accept] }}
            onConfirm={(assets: MediaAsset[]) => {
                const embeds = assets
                    .map(toWysiwygEmbed)
                    .filter((embed) => embed !== null);
                if (embeds.length > 0) onInsert(embeds);
                onOpenChange(false);
            }}
        />
    );
}
