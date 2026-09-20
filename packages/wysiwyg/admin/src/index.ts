export { WysiwygPlugin } from './lib/presentation/wysiwygPlugin';
export type { WysiwygAdminPlugin } from './lib/presentation/wysiwygPlugin';

// The `admin.widget` values a content schema can set on a `richtext` field to
// ask for — or opt out of — this editor.
//
// Nothing else is exported on purpose. The preview and the editor are behind a
// lazy import (see `wysiwygPlugin`), and re-exporting either from here would
// pull TipTap back into whatever chunk imports this module — which is the entry
// chunk, since the plugin factory has to run at boot.
export { WYSIWYG_WIDGET } from './lib/domain/constants';

// The media seam. A plugin that can browse or upload files fills
// `WYSIWYG_MEDIA_SLOT`, and the editor gains "Insert ▸ Media ▸ …" entries for
// it — `@orthacms/media-admin` contributes the Media Library picker and an
// upload. All type-only but the slot and the kind constants, so importing this
// costs a consumer nothing at runtime beyond the slot object itself.
export {
    WYSIWYG_MEDIA_KIND,
    WYSIWYG_MEDIA_KINDS,
    type WysiwygMediaKind
} from './lib/domain/constants';
export { WYSIWYG_MEDIA_SLOT } from './lib/presentation/slots/wysiwygSlots';
export type {
    WysiwygMediaEmbed,
    WysiwygMediaSourceContext,
    WysiwygMediaSourceItem
} from './lib/presentation/slots/wysiwygSlots';
