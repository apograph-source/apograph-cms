/**
 * The kinds of timed text a track can carry, mirroring HTML's `<track kind>`.
 *
 * `captions` and `subtitles` are deliberately separate, as they are in HTML and
 * in WCAG: captions carry the non-speech audio a deaf viewer needs (1.2.2),
 * while subtitles are a translation for someone who can hear it fine. Storing
 * one as the other publishes a `<track>` that claims to be something it is not.
 */
export const MEDIA_TRACK_KIND = [
    'captions',
    'subtitles',
    'descriptions',
    'chapters'
] as const;

/** One of {@link MEDIA_TRACK_KIND}. */
export type MediaTrackKind = (typeof MEDIA_TRACK_KIND)[number];

/**
 * One timed-text track attached to a video or audio asset.
 *
 * Lives in `domain/` rather than beside the Drizzle table it is stored in
 * (`infrastructure/schema/media-asset.ts` re-exports it, so every existing
 * import path still resolves). The aggregate carries tracks — `Asset.tracks`,
 * `Asset.setTracks` — and a domain type imported *out of* the persistence layer
 * points the layering the wrong way round: it makes `domain/` unusable without
 * the schema module, which is exactly what ADR-0003's one hard rule forbids.
 * The name keeps its `Stored` prefix because it is part of the published
 * surface of `@orthacms/media-server`.
 */
export interface StoredMediaTrack {
    /** What the track carries — see {@link MEDIA_TRACK_KIND}. */
    kind: MediaTrackKind;
    /**
     * BCP-47 tag of the track's language, e.g. `en` or `pt-BR`. Required: a
     * `<track>` with no `srclang` cannot be selected by a player and is
     * announced with the page's phonemes.
     */
    srclang: string;
    /** The label a player shows in its track menu, e.g. "English (CC)". */
    label: string;
    /** The media asset holding the WebVTT file itself. */
    assetId: string;
    /** Marks the track a player should enable by default. */
    default?: boolean;
}
