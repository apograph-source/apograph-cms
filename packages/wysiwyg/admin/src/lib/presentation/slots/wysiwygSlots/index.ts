/**
 * The WYSIWYG editor's **extension slot** — the seam another admin plugin fills
 * to give the editor somewhere to get media from.
 *
 * The editor knows how to *hold* an image or a video (see
 * `infrastructure/extensions/media`) and ships one way to name one: paste a URL.
 * It deliberately knows nothing about the Media Library. A picker that browses
 * folders, filters by kind, and uploads is the media plugin's whole job, and
 * wiring it in directly would mean `wysiwyg-admin` importing `media-admin` —
 * making rich text unusable in an install that has no media plugin, and
 * pinning the editor to one library's shape forever.
 *
 * So the editor declares what it needs (something that can hand back embeds)
 * and `@orthacms/media-admin` provides it, the same inversion content-admin
 * uses for its own slots.
 */

import type { ComponentType } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { createSlot } from '@orthacms/utils-admin';
import type { WysiwygMediaKind } from '../../../domain/constants';

/**
 * One piece of media to place in the document. Deliberately a **URL plus
 * display metadata**, not a library asset: it is equally satisfiable by an
 * upload, a library pick, or a link someone typed, which is what lets one node
 * type serve all three.
 */
export type WysiwygMediaEmbed = {
    /** Which node this becomes — an `<img>` or a `<video>`. */
    kind: WysiwygMediaKind;
    /** Where the bytes live. Must be `http(s)` or same-origin; see `mediaSrc`. */
    src: string;
    /** Alternative text. Images only, and the reason a picker should pass it on. */
    alt?: string;
    /**
     * Natural width in pixels, when the source knows it. Seeds the node so the
     * image lands at its own size instead of stretching to the column, and
     * gives the resize handle a sensible starting point.
     */
    width?: number;
};

/** What a media source is handed when the author opens it. */
export type WysiwygMediaSourceContext = {
    /** Whether this source's UI is open. */
    open: boolean;
    /** Close (or re-open) it. The editor owns which one is open. */
    onOpenChange: (open: boolean) => void;
    /**
     * The kinds this editor will accept. A source must not return anything
     * else — the editor has no node for it and would drop it silently.
     */
    accept: readonly WysiwygMediaKind[];
    /**
     * Place the chosen media at the caret. Call once with everything picked, in
     * the order it should appear; calling it does **not** close the source, so
     * an "insert and keep browsing" flow stays possible.
     */
    onInsert: (embeds: WysiwygMediaEmbed[]) => void;
};

/** One contributed way of getting media into the editor. */
export type WysiwygMediaSourceItem = {
    /** Stable id (React key, and the id the Insert menu opens by). */
    id: string;
    /** The Insert ▸ Media menu entry's label. */
    label: MessageDescriptor;
    /** Leading icon for that entry. */
    icon?: ComponentType<{ className?: string }>;
    /** Sort among sources (ascending). The built-in URL entry sits at 100. */
    order: number;
    /**
     * The source's UI — a dialog, a picker, an upload panel.
     *
     * Mounted by the **toolbar**, not by the menu item that opens it. A menu's
     * content unmounts the moment the menu closes, which is exactly when this
     * needs to appear; rendering it there would open a dialog into a tree that
     * is being torn down. Same reason content-admin's `ENTRY_MENU_SLOT` renders
     * its items' overlays outside the menu.
     *
     * It is mounted for the editor's whole life and told whether it is `open`,
     * so it owns its own state across openings.
     */
    Source: ComponentType<WysiwygMediaSourceContext>;
};

/**
 * Media sources for the rich-text editor. `@orthacms/media-admin` fills it
 * with **Media Library** (browse and pick) and **Upload** (send new files to
 * the library, then place them) — so an upload made from inside a body is a
 * first-class library asset, not an orphan attachment.
 *
 * With no contribution registered the editor still embeds media; the Insert
 * menu just offers the URL entry alone.
 */
export const WYSIWYG_MEDIA_SLOT = createSlot<WysiwygMediaSourceItem>(
    'wysiwyg.media.sources'
);
