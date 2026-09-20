import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Button,
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    InputField,
    Separator
} from '@orthacms/design-system';
import { Download, Link2, MoreVertical, X } from 'lucide-react';
import { MEDIA_KIND } from '../../constants';
import type { MediaAsset } from '../../types/mediaAsset';
import { formatBytes } from '../../utils/formatBytes';
import { formatDuration } from '../../utils/formatDuration';
import { buildAssetHandlers } from '../../utils/assetHandlers';
import { AssetActionsMenu, type AssetActionKind } from '../AssetActionsMenu';
import { MediaKindBadge } from '../MediaKindBadge';
import { MediaThumbnail } from '../MediaThumbnail';
import { MetaRow } from './MetaRow';

/** Intl descriptors for {@link AssetDetailDrawer}, co-located. */
const messages = defineMessages({
    close: { id: 'media.detail.close', defaultMessage: 'Close' },
    download: { id: 'media.detail.download', defaultMessage: 'Download' },
    copyLink: { id: 'media.detail.copyLink', defaultMessage: 'Copy link' },
    more: { id: 'media.detail.more', defaultMessage: 'More actions' },
    details: { id: 'media.detail.details', defaultMessage: 'Details' },
    type: { id: 'media.detail.type', defaultMessage: 'Type' },
    size: { id: 'media.detail.size', defaultMessage: 'Size' },
    dimensions: { id: 'media.detail.dimensions', defaultMessage: 'Dimensions' },
    duration: { id: 'media.detail.duration', defaultMessage: 'Duration' },
    format: { id: 'media.detail.format', defaultMessage: 'Format' },
    location: { id: 'media.detail.location', defaultMessage: 'Location' },
    uploadedBy: {
        id: 'media.detail.uploadedBy',
        defaultMessage: 'Uploaded by'
    },
    created: { id: 'media.detail.created', defaultMessage: 'Created' },
    modified: { id: 'media.detail.modified', defaultMessage: 'Modified' },
    altText: { id: 'media.detail.altText', defaultMessage: 'Alt text' },
    altPlaceholder: {
        id: 'media.detail.altPlaceholder',
        defaultMessage: 'Describe this image'
    },
    altHint: {
        id: 'media.detail.altHint',
        defaultMessage:
            'Read aloud in place of the image. Leave blank only if it is purely decorative.'
    },
    altSave: { id: 'media.detail.altSave', defaultMessage: 'Save alt text' },
    altMissing: {
        id: 'media.detail.altMissing',
        defaultMessage: 'No alt text yet'
    },
    tags: { id: 'media.detail.tags', defaultMessage: 'Tags' }
});

/**
 * The asset detail drawer — a right-hand panel with a large preview, primary
 * Download / Copy link actions and the shared ⋯ menu, then a metadata list
 * (type, size, dimensions, duration, format, location, uploader, timestamps),
 * alt text, and tags. Open state is derived from `asset` (null → closed); every
 * action dispatches up to the page.
 *
 * **Alt text is editable here** (with `media:update`) — it is the only route to
 * an asset's description after upload. The section used to render `asset.alt`
 * as read-only prose *and only when it was already set*, which meant an image
 * that landed without a description could never acquire one from the admin,
 * while the Insights alt-coverage card went on reporting the gap.
 */
export function AssetDetailDrawer({
    asset,
    locationLabel,
    onOpenChange,
    onAction,
    onSaveAlt,
    canCreate,
    canUpdate,
    canDelete
}: {
    asset: MediaAsset | null;
    /** Human name of the folder the asset lives in. */
    locationLabel: string;
    onOpenChange: (open: boolean) => void;
    onAction: (kind: AssetActionKind, asset: MediaAsset) => void;
    /** Persists the alt text; resolves whether the server accepted it. */
    onSaveAlt?: (id: string, alt: string) => Promise<boolean>;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
}) {
    const intl = useIntl();
    const altId = useId();
    const [alt, setAlt] = useState('');
    const [saving, setSaving] = useState(false);

    // Re-seed whenever a different asset opens, so the field never shows the
    // previous asset's description over this one's.
    const assetId = asset?.id ?? null;
    const assetAlt = asset?.alt ?? '';
    useEffect(() => {
        setAlt(assetAlt);
    }, [assetId, assetAlt]);

    const canEditAlt =
        canUpdate && !!onSaveAlt && asset?.kind === MEDIA_KIND.Image;
    const altDirty = alt !== (asset?.alt ?? '');

    const saveAlt = () => {
        if (!asset || !onSaveAlt) return;
        setSaving(true);
        void onSaveAlt(asset.id, alt).finally(() => setSaving(false));
    };
    const dateOpts = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    } as const;

    return (
        <Drawer
            direction="right"
            open={asset !== null}
            onOpenChange={onOpenChange}
        >
            <DrawerContent className="flex flex-col">
                {asset ? (
                    <>
                        <DrawerHeader className="flex flex-row items-center justify-between gap-3 border-b">
                            <DrawerTitle className="min-w-0 truncate">
                                {asset.name}
                            </DrawerTitle>
                            <DrawerClose asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0 shadow-none"
                                    aria-label={intl.formatMessage(
                                        messages.close
                                    )}
                                >
                                    <X aria-hidden />
                                </Button>
                            </DrawerClose>
                        </DrawerHeader>

                        <div className="flex-1 space-y-5 overflow-auto p-4">
                            <MediaThumbnail
                                asset={asset}
                                size="preview"
                                className="aspect-video w-full rounded-xl"
                                iconClassName="size-12"
                            />

                            <div className="flex items-center gap-2">
                                <Button
                                    className="flex-1"
                                    onClick={() => onAction('download', asset)}
                                >
                                    <Download aria-hidden />
                                    {intl.formatMessage(messages.download)}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 shadow-none"
                                    onClick={() => onAction('copyLink', asset)}
                                >
                                    <Link2 aria-hidden />
                                    {intl.formatMessage(messages.copyLink)}
                                </Button>
                                <AssetActionsMenu
                                    handlers={buildAssetHandlers(
                                        asset,
                                        onAction
                                    )}
                                    canCreate={canCreate}
                                    canUpdate={canUpdate}
                                    canDelete={canDelete}
                                    trigger={
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="shadow-none"
                                            aria-label={intl.formatMessage(
                                                messages.more
                                            )}
                                        >
                                            <MoreVertical aria-hidden />
                                        </Button>
                                    }
                                />
                            </div>

                            <div>
                                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {intl.formatMessage(messages.details)}
                                </h3>
                                <dl className="divide-y">
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.type
                                        )}
                                    >
                                        <MediaKindBadge kind={asset.kind} />
                                    </MetaRow>
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.size
                                        )}
                                    >
                                        {formatBytes(asset.size)}
                                    </MetaRow>
                                    {asset.dimensions ? (
                                        <MetaRow
                                            label={intl.formatMessage(
                                                messages.dimensions
                                            )}
                                        >
                                            {asset.dimensions.width}×
                                            {asset.dimensions.height}
                                        </MetaRow>
                                    ) : null}
                                    {asset.duration ? (
                                        <MetaRow
                                            label={intl.formatMessage(
                                                messages.duration
                                            )}
                                        >
                                            {formatDuration(asset.duration)}
                                        </MetaRow>
                                    ) : null}
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.format
                                        )}
                                    >
                                        {asset.mimeType}
                                    </MetaRow>
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.location
                                        )}
                                    >
                                        {locationLabel}
                                    </MetaRow>
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.uploadedBy
                                        )}
                                    >
                                        {asset.uploadedBy}
                                    </MetaRow>
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.created
                                        )}
                                    >
                                        {intl.formatDate(
                                            asset.createdAt,
                                            dateOpts
                                        )}
                                    </MetaRow>
                                    <MetaRow
                                        label={intl.formatMessage(
                                            messages.modified
                                        )}
                                    >
                                        {intl.formatDate(
                                            asset.updatedAt,
                                            dateOpts
                                        )}
                                    </MetaRow>
                                </dl>
                            </div>

                            {canEditAlt ? (
                                <div className="space-y-2">
                                    <InputField
                                        id={`asset-alt-${altId}`}
                                        label={intl.formatMessage(
                                            messages.altText
                                        )}
                                        description={intl.formatMessage(
                                            messages.altHint
                                        )}
                                        placeholder={intl.formatMessage(
                                            messages.altPlaceholder
                                        )}
                                        value={alt}
                                        maxLength={1000}
                                        onChange={(event) =>
                                            setAlt(event.target.value)
                                        }
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="shadow-none"
                                        disabled={!altDirty || saving}
                                        onClick={saveAlt}
                                    >
                                        {intl.formatMessage(messages.altSave)}
                                    </Button>
                                </div>
                            ) : (
                                <div>
                                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        {intl.formatMessage(messages.altText)}
                                    </h3>
                                    <p
                                        className={
                                            asset.alt
                                                ? 'text-sm'
                                                : 'text-sm text-muted-foreground'
                                        }
                                    >
                                        {asset.alt ??
                                            intl.formatMessage(
                                                messages.altMissing
                                            )}
                                    </p>
                                </div>
                            )}

                            {asset.tags.length > 0 ? (
                                <div>
                                    <Separator className="mb-3" />
                                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        {intl.formatMessage(messages.tags)}
                                    </h3>
                                    <div className="flex flex-wrap gap-1.5">
                                        {asset.tags.map((tag) => (
                                            <Badge
                                                key={tag}
                                                variant="outline"
                                                className="font-normal"
                                            >
                                                {tag}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </DrawerContent>
        </Drawer>
    );
}
