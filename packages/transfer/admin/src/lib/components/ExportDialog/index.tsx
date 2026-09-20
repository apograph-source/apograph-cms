import { useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Download } from 'lucide-react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    toast
} from '@orthacms/design-system';
import {
    DEFAULT_DEPTH,
    TRANSFER_FORMAT,
    TRANSFER_FORMATS,
    TRANSFER_FORMAT_CAPABILITIES,
    type TransferDepth,
    type TransferFormat
} from '@orthacms/transfer-domain';
import { useExportPreview } from '../../api/useExportPreview';
import { useExportDownload } from '../../api/useExportDownload';

const messages = defineMessages({
    title: {
        id: 'transfer.export.title',
        defaultMessage:
            'Export {count, plural, one {# record} other {# records}}'
    },
    description: {
        id: 'transfer.export.description',
        defaultMessage:
            'Exports the selected records plus one hop of what they reference. Their own references are kept as links, not copied.'
    },
    format: { id: 'transfer.export.format', defaultMessage: 'Format' },
    include: { id: 'transfer.export.include', defaultMessage: 'Include' },
    relations: {
        id: 'transfer.export.relations',
        defaultMessage: 'Related records'
    },
    relationsHint: {
        id: 'transfer.export.relations.hint',
        defaultMessage: 'One hop out — the records these ones link to.'
    },
    media: { id: 'transfer.export.media', defaultMessage: 'Files' },
    mediaHint: {
        id: 'transfer.export.media.hint',
        defaultMessage: 'Only a ZIP can carry the actual files.'
    },
    locales: { id: 'transfer.export.locales', defaultMessage: 'All languages' },
    localesHint: {
        id: 'transfer.export.locales.hint',
        defaultMessage: 'Every translation of the selected records.'
    },
    relationLocales: {
        id: 'transfer.export.relationLocales',
        defaultMessage: 'Languages of related records'
    },
    relationLocalesHint: {
        id: 'transfer.export.relationLocales.hint',
        defaultMessage: 'Off by default — this multiplies the size.'
    },
    counting: {
        id: 'transfer.export.counting',
        defaultMessage: 'Working out what this includes…'
    },
    countsWithFiles: {
        id: 'transfer.export.counts.files',
        defaultMessage:
            '{roots, plural, one {# record} other {# records}}, {related, plural, one {# related} other {# related}}, {assets, plural, one {# file} other {# files}} · {size}'
    },
    countsMetadataOnly: {
        id: 'transfer.export.counts.metadataOnly',
        defaultMessage:
            '{roots, plural, one {# record} other {# records}}, {related, plural, one {# related} other {# related}}, {assets, plural, one {# file} other {# files}} (listed, not included)'
    },
    countsFailed: {
        id: 'transfer.export.counts.failed',
        defaultMessage: 'Couldn’t work out the size. The export may still work.'
    },
    lossy: {
        id: 'transfer.export.lossy',
        defaultMessage:
            'CSV is a flat table: rich text becomes plain text, links become a list of keys, and files are listed by name only.'
    },
    zipNote: {
        id: 'transfer.export.zipNote',
        defaultMessage:
            'Several types export as separate files, so this download is a ZIP.'
    },
    cancel: { id: 'transfer.export.cancel', defaultMessage: 'Cancel' },
    confirm: { id: 'transfer.export.confirm', defaultMessage: 'Export' },
    done: {
        id: 'transfer.export.done.toast',
        defaultMessage:
            'Exported {count, plural, one {# record} other {# records}} to {filename}.'
    },
    failed: {
        id: 'transfer.export.failed.toast',
        defaultMessage: 'That export didn’t work. Please try again.'
    },
    formatJson: { id: 'transfer.format.json', defaultMessage: 'JSON' },
    formatNdjson: {
        id: 'transfer.format.ndjson',
        defaultMessage: 'JSON Lines'
    },
    formatZip: {
        id: 'transfer.format.zip',
        defaultMessage: 'ZIP archive (with files)'
    },
    formatCsv: { id: 'transfer.format.csv', defaultMessage: 'CSV (flat)' }
});

const FORMAT_LABEL = {
    [TRANSFER_FORMAT.Json]: messages.formatJson,
    [TRANSFER_FORMAT.Ndjson]: messages.formatNdjson,
    [TRANSFER_FORMAT.Zip]: messages.formatZip,
    [TRANSFER_FORMAT.Csv]: messages.formatCsv
} as const;

/** Bytes as something a person reads at a glance. */
function humanBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['kB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** One depth toggle with its label and hint. */
function DepthToggle({
    id,
    checked,
    disabled,
    label,
    hint,
    onChange
}: {
    id: string;
    checked: boolean;
    disabled?: boolean;
    label: string;
    hint: string;
    onChange: (next: boolean) => void;
}) {
    const hintId = `${id}-hint`;
    return (
        <div className="flex items-start gap-3">
            <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                aria-describedby={hintId}
                onCheckedChange={(next) => onChange(next === true)}
                className="mt-0.5"
            />
            <div className="grid gap-0.5">
                <Label htmlFor={id} className="font-normal">
                    {label}
                </Label>
                <span id={hintId} className="text-muted-foreground text-xs">
                    {hint}
                </span>
            </div>
        </div>
    );
}

/**
 * The export dialog, shared by the entry menu and the selection bar.
 *
 * Its job beyond collecting options is to make the depth toggles honest: the
 * live count underneath them is the same graph walk the export runs, so what it
 * says is what arrives. Without it, "include related records" is a coin flip
 * between a small file and a very large one.
 */
export function ExportDialog({
    open,
    onOpenChange,
    typeName,
    ids,
    onExported
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    typeName: string;
    /** The records to export. */
    ids: string[];
    /** Called after a successful download (clears a selection, closes a menu). */
    onExported?: () => void;
}) {
    const intl = useIntl();
    const fieldId = useId();
    const [format, setFormat] = useState<TransferFormat>(TRANSFER_FORMAT.Zip);
    const [depth, setDepth] = useState<TransferDepth>(DEFAULT_DEPTH);

    const capabilities = TRANSFER_FORMAT_CAPABILITIES[format];
    // A format that cannot carry bytes makes the media toggle a false promise,
    // so it is disabled and read as off rather than silently ignored.
    const mediaPossible = capabilities.carriesFileBytes;
    const effectiveDepth: TransferDepth = {
        ...depth,
        media: depth.media && mediaPossible,
        // Locales of relations only mean anything if relations are coming.
        relationLocales: depth.relationLocales && depth.relations
    };

    const preview = useExportPreview(
        typeName,
        ids,
        effectiveDepth,
        format,
        open
    );
    const download = useExportDownload();

    const runExport = (): void => {
        download
            .mutateAsync({ typeName, ids, format, depth: effectiveDepth })
            .then((outcome) => {
                toast.success(
                    intl.formatMessage(messages.done, {
                        count: outcome.records,
                        filename: outcome.filename
                    })
                );
                onOpenChange(false);
                onExported?.();
            })
            .catch(() => toast.error(intl.formatMessage(messages.failed)));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title, {
                            count: ids.length
                        })}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor={`${fieldId}-format`}>
                            {intl.formatMessage(messages.format)}
                        </Label>
                        <Select
                            value={format}
                            onValueChange={(next) =>
                                setFormat(next as TransferFormat)
                            }
                        >
                            <SelectTrigger id={`${fieldId}-format`}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TRANSFER_FORMATS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {intl.formatMessage(
                                            FORMAT_LABEL[value]
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!capabilities.lossless ? (
                            <p className="text-muted-foreground text-xs">
                                {intl.formatMessage(messages.lossy)}
                            </p>
                        ) : null}
                        {format === TRANSFER_FORMAT.Csv ? (
                            <p className="text-muted-foreground text-xs">
                                {intl.formatMessage(messages.zipNote)}
                            </p>
                        ) : null}
                    </div>

                    <fieldset className="grid gap-3">
                        <legend className="mb-1 text-sm font-medium">
                            {intl.formatMessage(messages.include)}
                        </legend>
                        <DepthToggle
                            id={`${fieldId}-relations`}
                            checked={depth.relations}
                            label={intl.formatMessage(messages.relations)}
                            hint={intl.formatMessage(messages.relationsHint)}
                            onChange={(relations) =>
                                setDepth((current) => ({
                                    ...current,
                                    relations
                                }))
                            }
                        />
                        <DepthToggle
                            id={`${fieldId}-media`}
                            checked={effectiveDepth.media}
                            disabled={!mediaPossible}
                            label={intl.formatMessage(messages.media)}
                            hint={intl.formatMessage(messages.mediaHint)}
                            onChange={(media) =>
                                setDepth((current) => ({ ...current, media }))
                            }
                        />
                        <DepthToggle
                            id={`${fieldId}-locales`}
                            checked={depth.locales}
                            label={intl.formatMessage(messages.locales)}
                            hint={intl.formatMessage(messages.localesHint)}
                            onChange={(locales) =>
                                setDepth((current) => ({ ...current, locales }))
                            }
                        />
                        <DepthToggle
                            id={`${fieldId}-relation-locales`}
                            checked={effectiveDepth.relationLocales}
                            disabled={!depth.relations}
                            label={intl.formatMessage(messages.relationLocales)}
                            hint={intl.formatMessage(
                                messages.relationLocalesHint
                            )}
                            onChange={(relationLocales) =>
                                setDepth((current) => ({
                                    ...current,
                                    relationLocales
                                }))
                            }
                        />
                    </fieldset>

                    {/*
                     * Announced politely: the numbers change as the toggles move,
                     * and a screen-reader user choosing options needs the same
                     * feedback a sighted one gets from watching them.
                     */}
                    <p
                        className="text-muted-foreground text-sm"
                        aria-live="polite"
                    >
                        {preview.isPending
                            ? intl.formatMessage(messages.counting)
                            : preview.isError
                              ? intl.formatMessage(messages.countsFailed)
                              : preview.data
                                ? intl.formatMessage(
                                      preview.data.carriesFileBytes
                                          ? messages.countsWithFiles
                                          : messages.countsMetadataOnly,
                                      {
                                          roots: preview.data.roots,
                                          related: preview.data.related,
                                          assets: preview.data.assets,
                                          size: humanBytes(
                                              preview.data.assetBytes
                                          )
                                      }
                                  )
                                : null}
                    </p>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        type="button"
                        disabled={download.isPending || ids.length === 0}
                        onClick={runExport}
                    >
                        {download.isPending ? (
                            <Spinner aria-hidden />
                        ) : (
                            <Download aria-hidden />
                        )}
                        {intl.formatMessage(messages.confirm)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
