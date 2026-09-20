import type { WysiwygMediaEmbed } from '@orthacms/wysiwyg-admin';
import { WYSIWYG_MEDIA_KIND } from '@orthacms/wysiwyg-admin';
import { MEDIA_KIND } from '../../constants';
import type { MediaAsset } from '../../types/mediaAsset';

/**
 * A library asset as the rich-text editor's embed — the one place this plugin
 * translates its own model into the editor's.
 *
 * Returns `null` for an asset the editor has no node for (audio, a PDF, a zip).
 * The picker already filters those out; this is the second gate, so a caller
 * that skips the filter can't put a `<img src="report.pdf">` in a body.
 *
 * ### Which URL
 *
 * An image embeds its **`previewUrl`** — the ~1280px derivative — not the
 * original. A body rendered on a page has no use for a 12-megapixel JPEG, and
 * the derivative is what the library generated it for. Falling back to `url`
 * covers an SVG or a small image that got no derivative. A video always embeds
 * `url`: there are no video derivatives, and the tag streams it.
 *
 * The asset's own `alt` rides along, so an author who wrote it once in the
 * library doesn't write it again per body.
 */
export function toWysiwygEmbed(asset: MediaAsset): WysiwygMediaEmbed | null {
    if (asset.kind === MEDIA_KIND.Image) {
        return {
            kind: WYSIWYG_MEDIA_KIND.Image,
            src: asset.previewUrl || asset.url,
            ...(asset.alt ? { alt: asset.alt } : {}),
            // Seeds the node (and the resize handle) with the asset's own
            // width, so it lands at its natural size rather than stretched to
            // the column. `previewUrl` is a *scaled* derivative, so the stored
            // dimensions overstate it — the browser scales to fit either way,
            // and the number is only ever a starting point the author drags.
            ...(asset.dimensions ? { width: asset.dimensions.width } : {})
        };
    }
    if (asset.kind === MEDIA_KIND.Video) {
        return {
            kind: WYSIWYG_MEDIA_KIND.Video,
            src: asset.url,
            ...(asset.dimensions ? { width: asset.dimensions.width } : {})
        };
    }
    return null;
}
