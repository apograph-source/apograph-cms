import { Play } from 'lucide-react';
import { cn } from '@orthacms/design-system';
import { MEDIA_KIND } from '../../constants';
import type { MediaAsset } from '../../types/mediaAsset';
import { assetGradient } from '../../utils/assetGradient';
import { formatDuration } from '../../utils/formatDuration';
import { MediaKindIcon } from '../MediaKindIcon';

/**
 * The visual preview for an asset. Image assets render a real thumbnail served
 * from the media API — the small `thumb` derivative by default, or the larger
 * `preview` when `size="preview"` (the detail drawer) — falling back to the
 * original when no derivative exists (e.g. SVG). A deterministic gradient tile
 * sits underneath as the backdrop / loading state; non-image kinds show it with
 * a centred kind glyph. Video/audio get a play affordance and a duration pill.
 * Sized entirely by the parent via `className` (aspect + radius), so it serves
 * tiles, list rows, and the drawer.
 */
export function MediaThumbnail({
    asset,
    className,
    iconClassName,
    size = 'thumb'
}: {
    asset: MediaAsset;
    className?: string;
    iconClassName?: string;
    /** Which derivative to prefer — the grid uses `thumb`, the drawer `preview`. */
    size?: 'thumb' | 'preview';
}) {
    const isImage = asset.kind === MEDIA_KIND.Image;
    const isPlayable =
        asset.kind === MEDIA_KIND.Video || asset.kind === MEDIA_KIND.Audio;
    // Prefer the requested derivative, then the other, then the original.
    const imageSrc =
        size === 'preview'
            ? (asset.previewUrl ?? asset.thumbUrl ?? asset.url)
            : (asset.thumbUrl ?? asset.previewUrl ?? asset.url);

    return (
        <div
            className={cn(
                'relative flex items-center justify-center overflow-hidden bg-muted',
                className
            )}
            style={{ backgroundImage: assetGradient(asset.id) }}
        >
            {/* A soft wash so overlaid glyphs stay legible on any hue. */}
            <div className="absolute inset-0 bg-black/5" aria-hidden />
            {isImage ? (
                <img
                    src={imageSrc}
                    alt={asset.alt ?? ''}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                />
            ) : (
                <MediaKindIcon
                    kind={asset.kind}
                    className={cn(
                        'relative size-8 text-white/90 drop-shadow-sm',
                        iconClassName
                    )}
                />
            )}
            {isPlayable ? (
                <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    <Play className="size-3 fill-current" aria-hidden />
                    {asset.duration ? formatDuration(asset.duration) : null}
                </span>
            ) : null}
        </div>
    );
}
