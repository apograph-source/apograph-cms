import { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { RefreshCw } from 'lucide-react';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import {
    Button,
    cn,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner,
    toast
} from '@orthacms/design-system';
import { CONTENT_SEGMENT } from '../../../../domain/constants';
import { useBulkPublishFlow } from '../../../../application/useBulkPublishFlow';
import { VerdictRow } from './VerdictRow';

const messages = defineMessages({
    title: {
        id: 'content.bulkPublish.title',
        defaultMessage:
            'Publish {count, plural, one {# record} other {# records}}?'
    },
    body: {
        id: 'content.bulkPublish.body',
        defaultMessage:
            'Each record is checked below. Only valid drafts will publish.'
    },
    loading: {
        id: 'content.bulkPublish.loading',
        defaultMessage: 'Checking records…'
    },
    error: {
        id: 'content.bulkPublish.error',
        defaultMessage: 'Couldn’t check these records. Please try again.'
    },
    recheck: {
        id: 'content.bulkPublish.recheck',
        defaultMessage: 'Re-check'
    },
    cancel: { id: 'content.bulkPublish.cancel', defaultMessage: 'Cancel' },
    confirm: {
        id: 'content.bulkPublish.confirm',
        defaultMessage:
            'Publish {count, plural, =0 {none} one {# valid} other {# valid}}'
    },
    summaryReady: {
        id: 'content.bulkPublish.summaryReady',
        defaultMessage:
            '{count, plural, one {# record will publish} other {# records will publish}}.'
    },
    summaryNone: {
        id: 'content.bulkPublish.summaryNone',
        defaultMessage:
            'None of the selected records can be published — they’re already published or blocked.'
    },
    result: {
        id: 'content.bulkPublish.result',
        defaultMessage:
            '{count, plural, one {# record published} other {# records published}}.'
    },
    failed: {
        id: 'content.bulkPublish.failed',
        defaultMessage: 'Publishing didn’t complete. Please try again.'
    }
});

/**
 * The bulk-publish pre-flight modal. On open it dry-runs a publish over the
 * selected ids (`previewPublish`, which validates each server-side and writes
 * nothing) and lists each record's verdict — will publish / already published /
 * blocked (with its validation issues) / no longer available. Confirming
 * publishes **only the valid drafts** (`publish`, which re-validates on the
 * server), toasts how many went out, clears the selection, and closes.
 */
export function BulkPublishDialog({
    open,
    onOpenChange,
    typeName,
    ids,
    labels,
    labelFor,
    onPublished
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    typeName: string;
    /** The selected entry ids to publish. */
    ids: string[];
    /**
     * Override the selection-flavoured heading and body. A caller publishing a
     * *known* set — the i18n plugin's "all locales" action — says so in its own
     * words; the default stays "Publish {n} records?".
     */
    labels?: { title?: string; body?: string };
    /**
     * Override a row's name by id. The verdict carries the record's title, which
     * is right for a table selection and wrong for a set of locale siblings —
     * there, every row is the *same* record and the locale is what tells them
     * apart.
     */
    labelFor?: (id: string) => string | undefined;
    /** Called after a successful publish (e.g. to clear the selection). */
    onPublished: () => void;
}) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const flow = useBulkPublishFlow(typeName);
    const { preview: runPreview, resetPreview } = flow;

    // The entry-editor URL for a record, opened in a new tab from a verdict row.
    const recordHref = (id: string) =>
        `/workspaces/${workspace.id}/${CONTENT_SEGMENT}/${typeName}/${id}`;

    // Dry-run whenever the dialog opens for the current selection.
    useEffect(() => {
        if (open) runPreview(ids);
        else resetPreview();
        // `ids` is captured at open; selection is frozen while the dialog is up.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const items = flow.verdicts;
    const validCount = flow.publishableCount;

    const onConfirm = () => {
        flow.commit(ids)
            .then((result) => {
                toast.success(
                    intl.formatMessage(messages.result, {
                        count: result.published.length
                    })
                );
                onPublished();
                onOpenChange(false);
            })
            .catch(() => toast.error(intl.formatMessage(messages.failed)));
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!flow.isPublishing) onOpenChange(next);
            }}
        >
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {labels?.title ??
                            intl.formatMessage(messages.title, {
                                count: ids.length
                            })}
                    </DialogTitle>
                    <DialogDescription>
                        {labels?.body ?? intl.formatMessage(messages.body)}
                    </DialogDescription>
                </DialogHeader>

                {/* Re-run the dry run to refetch each selected record's status. */}
                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shadow-none"
                        onClick={() => runPreview(ids)}
                        disabled={flow.isPreviewing || flow.isPublishing}
                    >
                        <RefreshCw
                            className={cn(
                                'size-4',
                                flow.isPreviewing && 'ds-spinner'
                            )}
                            aria-hidden
                        />
                        {intl.formatMessage(messages.recheck)}
                    </Button>
                </div>

                {flow.isPreviewing ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Spinner aria-hidden />
                        {intl.formatMessage(messages.loading)}
                    </div>
                ) : flow.isPreviewError ? (
                    <p role="alert" className="py-4 text-sm text-destructive">
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : (
                    <>
                        <ul className="flex max-h-96 flex-col gap-2 overflow-auto pr-1">
                            {items.map((item) => (
                                <VerdictRow
                                    key={item.id}
                                    item={item}
                                    name={labelFor?.(item.id)}
                                    recordHref={recordHref}
                                />
                            ))}
                        </ul>
                        {items.length > 0 && (
                            // Announced summary so a screen-reader user learns the
                            // outcome — and why the confirm button is disabled when
                            // nothing is publishable — without scanning every row.
                            <p
                                role="status"
                                className="text-sm text-muted-foreground"
                            >
                                {validCount === 0
                                    ? intl.formatMessage(messages.summaryNone)
                                    : intl.formatMessage(
                                          messages.summaryReady,
                                          { count: validCount }
                                      )}
                            </p>
                        )}
                    </>
                )}

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={flow.isPublishing}
                    >
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={
                            flow.isPublishing ||
                            flow.isPreviewing ||
                            validCount === 0
                        }
                    >
                        {flow.isPublishing ? <Spinner aria-hidden /> : null}
                        {intl.formatMessage(messages.confirm, {
                            count: validCount
                        })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
