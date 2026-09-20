import { defineMessages, useIntl } from 'react-intl';
import { Checkbox, cn } from '@orthacms/design-system';
import type { MediaAsset } from '../../../types/mediaAsset';
import { formatBytes } from '../../../utils/formatBytes';
import { buildAssetHandlers } from '../../../utils/assetHandlers';
import { AssetActionsMenu, type AssetActionKind } from '../../AssetActionsMenu';
import { MediaThumbnail } from '../../MediaThumbnail';

/** Intl descriptors for {@link MediaAssetCard}, co-located. */
const messages = defineMessages({
    open: { id: 'media.assetCard.open', defaultMessage: 'Open {name}' },
    select: { id: 'media.assetCard.select', defaultMessage: 'Select {name}' }
});

/**
 * An asset tile in the grid — a gradient thumbnail with a hover ⋯ menu and a
 * selection checkbox (always visible once selected), over the name and a
 * size/dimensions line. Clicking the thumbnail or name opens the detail drawer;
 * the checkbox toggles selection. A selected tile gets a primary ring.
 */
export function MediaAssetCard({
    asset,
    selected,
    onToggleSelect,
    onAction,
    canCreate,
    canUpdate,
    canDelete
}: {
    asset: MediaAsset;
    selected: boolean;
    onToggleSelect: (id: string) => void;
    onAction: (kind: AssetActionKind, asset: MediaAsset) => void;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
}) {
    const intl = useIntl();
    const handlers = buildAssetHandlers(asset, onAction);

    return (
        <div
            className={cn(
                'group relative overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md',
                selected && 'ring-2 ring-primary ring-offset-1'
            )}
        >
            <div className="relative">
                <button
                    type="button"
                    onClick={() => onAction('open', asset)}
                    aria-label={intl.formatMessage(messages.open, {
                        name: asset.name
                    })}
                    className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <MediaThumbnail
                        asset={asset}
                        className="aspect-[4/3] w-full"
                    />
                </button>

                <div
                    className={cn(
                        'absolute left-2 top-2 rounded-md bg-background/80 p-0.5 shadow-sm backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100',
                        selected ? 'opacity-100' : 'opacity-0'
                    )}
                >
                    <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleSelect(asset.id)}
                        aria-label={intl.formatMessage(messages.select, {
                            name: asset.name
                        })}
                    />
                </div>

                <div className="absolute right-2 top-2 rounded-md bg-background/80 shadow-sm backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
                    <AssetActionsMenu
                        handlers={handlers}
                        assetName={asset.name}
                        canCreate={canCreate}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                    />
                </div>
            </div>

            <div className="p-3">
                <button
                    type="button"
                    onClick={() => onAction('open', asset)}
                    className="block w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={asset.name}
                >
                    {asset.name}
                </button>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatBytes(asset.size)}
                    {asset.dimensions
                        ? ` · ${asset.dimensions.width}×${asset.dimensions.height}`
                        : null}
                </p>
            </div>
        </div>
    );
}
