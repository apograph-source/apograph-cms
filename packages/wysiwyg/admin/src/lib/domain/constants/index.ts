/**
 * The WYSIWYG plugin's pure vocabulary — the values that appear in stored
 * content or decide which fields the editor claims. No React, no TipTap: the
 * extensions, the toolbar, and the stylesheet all read these, so a tone or a
 * swatch is declared once.
 */

/**
 * `admin.widget` values this plugin reads on a `richtext` field.
 *
 * The editor claims every `richtext` field **by default** — a rich-text field
 * that renders as a raw HTML textarea is the thing this plugin exists to
 * replace. `widget: 'textarea'` is the deliberate opt-out for a field whose
 * body isn't authored prose (a hand-maintained HTML snippet, an email
 * template), where a plain box is the honest control. `widget: 'wysiwyg'` is
 * accepted too, so a schema can state the intent rather than rely on the
 * default.
 */
export const WYSIWYG_WIDGET = {
    /** Explicitly ask for this editor (the default anyway). */
    Wysiwyg: 'wysiwyg',
    /** Opt out — keep content-admin's plain `Textarea`. */
    Textarea: 'textarea'
} as const;

/** The media kinds the editor can hold — one node type each. */
export const WYSIWYG_MEDIA_KIND = {
    /** An `<img>`. */
    Image: 'image',
    /** A `<video controls>`. */
    Video: 'video'
} as const;

/** A media kind the editor can hold. */
export type WysiwygMediaKind =
    (typeof WYSIWYG_MEDIA_KIND)[keyof typeof WYSIWYG_MEDIA_KIND];

/** Every kind, for a source that accepts whatever the editor does. */
export const WYSIWYG_MEDIA_KINDS: readonly WysiwygMediaKind[] = [
    WYSIWYG_MEDIA_KIND.Image,
    WYSIWYG_MEDIA_KIND.Video
];

/**
 * Narrowest a resized media block may get, in pixels. Below this the drag
 * handle is bigger than what it is resizing, and the block stops being
 * recognisable as the thing the author placed.
 */
export const MEDIA_MIN_WIDTH = 64;

/** How far one arrow-key press moves the resize handle (Shift ×4). */
export const MEDIA_RESIZE_STEP = 16;

/**
 * Where a media block sits across the measure — the `data-align` written into
 * the stored HTML.
 *
 * Media does **not** use `text-align`. An image is a block in the flow, and
 * `text-align` positions a block's inline *children*, not the block itself — so
 * the property the text alignment extension writes lands on the image and moves
 * nothing. A block moves by its margins, which is what the stylesheet does with
 * this attribute.
 *
 * There is no `justify`: it spreads a line's words to both edges, and a picture
 * has no words to spread.
 */
export const MEDIA_ALIGN = {
    /** The default — where a block sits with no margins of its own. */
    Left: 'left',
    Center: 'center',
    Right: 'right'
} as const;

/** Where a media block sits. */
export type MediaAlign = (typeof MEDIA_ALIGN)[keyof typeof MEDIA_ALIGN];

/** Every alignment media can take, in the order the toolbar menu lists them. */
export const MEDIA_ALIGNS: readonly MediaAlign[] = [
    MEDIA_ALIGN.Left,
    MEDIA_ALIGN.Center,
    MEDIA_ALIGN.Right
];

/** Narrows an unknown attribute value to an alignment, defaulting to left. */
export function asMediaAlign(value: unknown): MediaAlign {
    return MEDIA_ALIGNS.includes(value as MediaAlign)
        ? (value as MediaAlign)
        : MEDIA_ALIGN.Left;
}

/** A callout's severity — the `data-tone` written into the stored HTML. */
export const CALLOUT_TONE = {
    Info: 'info',
    Success: 'success',
    Warning: 'warning',
    Danger: 'danger'
} as const;

/** A callout tone. */
export type CalloutTone = (typeof CALLOUT_TONE)[keyof typeof CALLOUT_TONE];

/** Every tone, in the order the toolbar menu lists them. */
export const CALLOUT_TONES: readonly CalloutTone[] = [
    CALLOUT_TONE.Info,
    CALLOUT_TONE.Success,
    CALLOUT_TONE.Warning,
    CALLOUT_TONE.Danger
];

/** Column layouts the toolbar offers. Two is the common case; four is the cap. */
export const COLUMN_COUNTS: readonly number[] = [2, 3, 4];

/** Fewest columns a column block can hold — one column is just a paragraph. */
export const MIN_COLUMNS = 2;

/** Most columns a column block can hold. */
export const MAX_COLUMNS = 4;

/** A palette entry / size step: a stable `id` for its label, and the CSS value. */
export type SwatchOption = {
    /** Stable key the toolbar looks its translated label up by. */
    readonly id: string;
    /** The CSS value written into the stored HTML. Absent = "clear the mark". */
    readonly value?: string;
};

/**
 * Text sizes offered by the size menu, as the `font-size` written onto a
 * `<span style>` in the stored HTML. The `default` step carries no value: it
 * clears the mark and lets the paragraph/heading decide, which is not the same
 * as pinning the run to `1rem`.
 */
export const FONT_SIZES: readonly SwatchOption[] = [
    { id: 'default' },
    { id: 'small', value: '0.875rem' },
    { id: 'normal', value: '1rem' },
    { id: 'medium', value: '1.25rem' },
    { id: 'large', value: '1.5rem' },
    { id: 'xlarge', value: '2rem' }
];

/**
 * Text colors, as hex — these are **content**, not admin chrome: they ride the
 * stored HTML out to whatever renders it, so they can't be theme variables that
 * only exist inside this app. Chosen to stay legible on a light page, which is
 * what the HTML most often lands on.
 */
export const TEXT_COLORS: readonly Required<SwatchOption>[] = [
    { id: 'slate', value: '#334155' },
    { id: 'gray', value: '#6b7280' },
    { id: 'red', value: '#dc2626' },
    { id: 'orange', value: '#ea580c' },
    { id: 'amber', value: '#b45309' },
    { id: 'green', value: '#15803d' },
    { id: 'teal', value: '#0f766e' },
    { id: 'blue', value: '#1d4ed8' },
    { id: 'violet', value: '#6d28d9' },
    { id: 'pink', value: '#be185d' }
];

/**
 * Highlight (marker) colors. Pale on purpose: a highlight sits *behind* body
 * text, so anything saturated costs the text its contrast wherever this HTML
 * ends up.
 */
export const HIGHLIGHT_COLORS: readonly Required<SwatchOption>[] = [
    { id: 'yellow', value: '#fef08a' },
    { id: 'lime', value: '#d9f99d' },
    { id: 'green', value: '#bbf7d0' },
    { id: 'cyan', value: '#a5f3fc' },
    { id: 'blue', value: '#bfdbfe' },
    { id: 'violet', value: '#ddd6fe' },
    { id: 'pink', value: '#fbcfe8' },
    { id: 'red', value: '#fecaca' }
];

/**
 * The class the editor surface and every preview carry. The plugin's stylesheet
 * hangs all of its rich-text rules off it, so those rules can never leak onto
 * the rest of the admin — and the two surfaces are guaranteed to render the
 * same HTML the same way, which is the whole promise of a preview.
 */
export const WYSIWYG_PROSE_CLASS = 'ortha-wysiwyg';
