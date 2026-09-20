import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@orthacms/design-system';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { WysiwygMediaSourceContext } from '@orthacms/wysiwyg-admin';
import { ROOT_FOLDER_ID } from '../../constants';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { mediaKeys } from '../../infrastructure/mediaKeys';
import { acceptsFile } from '../../utils/mediaAccept';
import { toWysiwygEmbed } from '../../utils/toWysiwygEmbed';
import { UploadDialog } from '../UploadDialog';

const messages = defineMessages({
    location: {
        id: 'media.wysiwygUpload.location',
        defaultMessage: 'All media'
    },
    description: {
        id: 'media.wysiwygUpload.description',
        defaultMessage:
            'Files are added to the Media Library, then placed in the text.'
    },
    confirm: {
        id: 'media.wysiwygUpload.confirm',
        defaultMessage: 'Upload and insert'
    },
    rejected: {
        id: 'media.wysiwygUpload.rejected',
        defaultMessage:
            '{name} isn’t an image or a video, so it can’t go in the text.'
    },
    failed: {
        id: 'media.wysiwygUpload.failed',
        defaultMessage: 'Couldn’t upload {name}. Nothing was inserted for it.'
    }
});

/** The file-picker `accept` matching the kinds a body can hold. */
const FILE_ACCEPT = 'image/*,video/*';

/**
 * Upload as a **rich-text media source** — the plugin's second contribution to
 * `WYSIWYG_MEDIA_SLOT`.
 *
 * Files go **into the Media Library** and are then placed in the text, rather
 * than being embedded as data URIs or attached to the record alone. That is the
 * behaviour a CMS wants: an image used in a body is an asset like any other —
 * findable, reusable, replaceable — and a body full of base64 is unshippable.
 *
 * ### Why this uploads immediately, unlike a media *field*
 *
 * A media field defers its uploads to the record's save
 * (`usePendingMediaUploads`), because a field holds an id and an abandoned edit
 * would otherwise litter the library. A body holds a **URL**, and there is no
 * URL until the bytes exist — so the upload has to happen now. The trade is
 * real and one-directional: abandoning the edit leaves the asset in the
 * library, where it is visible and deletable, rather than leaving the body
 * pointing at nothing.
 *
 * Each file is its own request, so one failure costs one file: the rest still
 * insert, and the toast names the one that didn't.
 */
export function WysiwygUploadSource({
    open,
    onOpenChange,
    accept,
    onInsert
}: WysiwygMediaSourceContext) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);

    const upload = async (files: File[]) => {
        onOpenChange(false);
        if (busy) return;
        setBusy(true);

        // Checked before anything is sent: a PDF would upload fine and then be
        // silently unusable, which reads as the editor losing the file.
        const usable = files.filter((file) => {
            if (acceptsFile({ kinds: [...accept] }, file)) return true;
            toast.error(
                intl.formatMessage(messages.rejected, { name: file.name })
            );
            return false;
        });

        let uploaded = false;
        for (const file of usable) {
            try {
                const asset = await httpMediaGateway.uploadFile(
                    ROOT_FOLDER_ID,
                    file
                );
                uploaded = true;
                const embed = toWysiwygEmbed(asset);
                // Inserted one at a time, in order, so a long batch appears as
                // it lands rather than all at the end.
                if (embed) onInsert([embed]);
            } catch {
                toast.error(
                    intl.formatMessage(messages.failed, { name: file.name })
                );
            }
        }

        // The library is stale the moment anything landed — even if a later
        // file failed.
        if (uploaded) {
            void queryClient.invalidateQueries({
                queryKey: mediaKeys.all(workspace.id)
            });
        }
        setBusy(false);
    };

    return (
        <UploadDialog
            open={open}
            onOpenChange={onOpenChange}
            locationLabel={intl.formatMessage(messages.location)}
            description={intl.formatMessage(messages.description)}
            confirmLabel={intl.formatMessage(messages.confirm)}
            accept={FILE_ACCEPT}
            multiple
            onUpload={(uploads) =>
                void upload(uploads.map((staged) => staged.file))
            }
        />
    );
}
