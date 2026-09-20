import { defineMessages, useIntl } from 'react-intl';
import { Check } from 'lucide-react';
import { cn } from '@orthacms/design-system';
import type { MediaAsset } from '../../../types/mediaAsset';
import { formatBytes } from '../../../utils/formatBytes';
import { MediaThumbnail } from '../../MediaThumbnail';

/** Intl descriptors for {@link MediaPickerTile}, co-located. */
const messages = defineMessages({
    attached: {
        id: 'media.pickerTile.attached',
        defaultMessage: 'Attached'
    },
    attachedHint: {
        id: 'media.pickerTile.attachedHint',
        defaultMessage: '{name} — already attached to this field'
    }
});

/**
 * One candidate asset in the {@link MediaPickerDialog} — a thumbnail over the
 * file name and its size / dimensions, as a single toggle button (`aria-pressed`
 * carries the selection to assistive tech). A selected tile takes the primary
 * ring and a check; one already attached to the field is marked so the user
 * doesn't pick a duplicate — it stays clickable, since in single mode re-picking
 * the current asset is a legitimate no-op.
 */
export function MediaPickerTile({
    asset,
    picked,
    attached,
    onToggle
}: {
    asset: MediaAsset;
    picked: boolean;
    /** Already on the field — rendered as a badge, still selectable. */
    attached: boolean;
    onToggle: () => void;
}) {
    const intl = useIntl();
    const meta = [
        formatBytes(asset.size),
        asset.dimensions
            ? `${asset.dimensions.width}×${asset.dimensions.height}`
            : null
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <button
            type="button"
            aria-pressed={picked}
            onClick={onToggle}
            title={
                attached
                    ? intl.formatMessage(messages.attachedHint, {
                          name: asset.name
                      })
                    : asset.name
            }
            className={cn(
                'group/tile relative block w-full overflow-hidden rounded-lg border bg-card text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                picked
                    ? 'border-primary ring-2 ring-primary'
                    : 'hover:border-primary/40'
            )}
        >
            <MediaThumbnail asset={asset} className="aspect-[4/3] w-full" />

            {picked ? (
                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Check className="size-3" aria-hidden />
                </span>
            ) : null}

            {attached ? (
                <span className="absolute left-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur">
                    {intl.formatMessage(messages.attached)}
                </span>
            ) : null}

            <span className="block min-w-0 px-2.5 py-2">
                <span className="block truncate text-xs font-medium">
                    {asset.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                    {meta}
                </span>
            </span>
        </button>
    );
}
