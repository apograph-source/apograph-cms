import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ConfirmDialog, toast } from '@ortha/design-system';
import { useHasPermission } from '@ortha/identity-admin';
import type {
    ContentTypeDetail,
    RevisionSummary
} from '../../../../../domain/types/contentType';
import {
    CONTENT_PUBLISH,
    CONTENT_UPDATE
} from '../../../../../domain/constants';
import { useRevisionActions } from '../../../../../application/useRevisionActions';
import { RevisionRow } from './RevisionRow';
import { RevisionPreviewDialog } from './RevisionPreviewDialog';

const messages = defineMessages({
    confirmTitle: {
        id: 'content.revisions.confirmTitle',
        defaultMessage: 'Restore version {n}?'
    },
    confirmBody: {
        id: 'content.revisions.confirmBody',
        defaultMessage:
            'This re-applies that version to the record and saves it as a new revision. Nothing in the history is lost.'
    },
    confirm: {
        id: 'content.revisions.confirm',
        defaultMessage: 'Restore'
    },
    restored: {
        id: 'content.revisions.restored',
        defaultMessage: 'Restored version {n} as a new revision.'
    },
    restoreFailed: {
        id: 'content.revisions.restoreFailed',
        defaultMessage: 'Could not restore that version. Please try again.'
    },
    publishConfirmTitle: {
        id: 'content.revisions.publishConfirmTitle',
        defaultMessage: 'Publish version {n}?'
    },
    publishConfirmBody: {
        id: 'content.revisions.publishConfirmBody',
        defaultMessage:
            'This makes that version the live one. An earlier version is re-applied to the record first; the currently live version becomes superseded.'
    },
    publishConfirm: {
        id: 'content.revisions.publishConfirm',
        defaultMessage: 'Publish'
    },
    published: {
        id: 'content.revisions.published',
        defaultMessage: 'Version {n} is now live.'
    },
    publishFailed: {
        id: 'content.revisions.publishFailed',
        defaultMessage: 'Could not publish that version. It may be incomplete.'
    }
});

/**
 * The shared revision list — the core of both the sidebar {@link RevisionWidget}
 * and the History-tab timeline. Renders a {@link RevisionRow} per revision and
 * owns the **restore** and **publish-a-version** flows (permission gates,
 * confirmations, and success / failure toasts) so both mount points behave
 * identically. Restore re-applies a snapshot as a new draft; publish makes a
 * chosen version the live one (an earlier version is restored then published).
 */
export function RevisionList({
    typeName,
    entryId,
    schema,
    revisions,
    compact = false
}: {
    typeName: string;
    entryId: string;
    /** The type's full field schema — drives the preview diff's labels + values. */
    schema: ContentTypeDetail;
    revisions: RevisionSummary[];
    /** Icon-only row actions — the compact right-rail widget. */
    compact?: boolean;
}) {
    const intl = useIntl();
    const canUpdate = useHasPermission(CONTENT_UPDATE);
    const canPublish = useHasPermission(CONTENT_PUBLISH);
    const publishable = schema.publishable ?? false;
    const { restore, restoring, publish, publishing } = useRevisionActions(
        typeName,
        entryId
    );
    const [pending, setPending] = useState<number | null>(null);
    const [pendingPublish, setPendingPublish] = useState<number | null>(null);
    const [previewing, setPreviewing] = useState<RevisionSummary | null>(null);

    // The diff baseline: the newest version equals the live record (every save
    // appends one). It's always present here — both mount points pass a
    // newest-first list — but fall back to the highest number defensively.
    const latestNumber =
        revisions.find((revision) => revision.isLatest)?.number ??
        revisions.reduce((max, r) => Math.max(max, r.number), 0);

    const confirmRestore = () => {
        if (pending == null) return;
        const number = pending;
        restore(number, {
            onSuccess: () =>
                toast.success(
                    intl.formatMessage(messages.restored, { n: number })
                ),
            onError: () =>
                toast.error(intl.formatMessage(messages.restoreFailed))
        });
        setPending(null);
    };

    const confirmPublish = () => {
        if (pendingPublish == null) return;
        const number = pendingPublish;
        publish(number, {
            onSuccess: () =>
                toast.success(
                    intl.formatMessage(messages.published, { n: number })
                ),
            onError: () =>
                toast.error(intl.formatMessage(messages.publishFailed))
        });
        setPendingPublish(null);
    };

    return (
        <>
            <ul className="divide-y divide-border/60">
                {revisions.map((revision) => (
                    <li key={revision.id}>
                        <RevisionRow
                            revision={revision}
                            canUpdate={canUpdate}
                            canPublish={canPublish}
                            publishable={publishable}
                            busy={restoring || publishing}
                            onRestore={setPending}
                            onPublish={setPendingPublish}
                            onPreview={() => setPreviewing(revision)}
                            compact={compact}
                        />
                    </li>
                ))}
            </ul>
            <ConfirmDialog
                open={pending != null}
                onOpenChange={(open) => !open && setPending(null)}
                title={intl.formatMessage(messages.confirmTitle, {
                    n: pending ?? 0
                })}
                description={intl.formatMessage(messages.confirmBody)}
                confirmLabel={intl.formatMessage(messages.confirm)}
                busy={restoring}
                onConfirm={confirmRestore}
            />
            <ConfirmDialog
                open={pendingPublish != null}
                onOpenChange={(open) => !open && setPendingPublish(null)}
                title={intl.formatMessage(messages.publishConfirmTitle, {
                    n: pendingPublish ?? 0
                })}
                description={intl.formatMessage(messages.publishConfirmBody)}
                confirmLabel={intl.formatMessage(messages.publishConfirm)}
                busy={publishing}
                onConfirm={confirmPublish}
            />
            {previewing && (
                <RevisionPreviewDialog
                    open
                    onOpenChange={(open) => !open && setPreviewing(null)}
                    typeName={typeName}
                    entryId={entryId}
                    schema={schema}
                    revision={previewing}
                    latestNumber={latestNumber}
                    canRestore={canUpdate}
                    canPublish={canPublish && publishable}
                    onRestore={setPending}
                    onPublish={setPendingPublish}
                />
            )}
        </>
    );
}
