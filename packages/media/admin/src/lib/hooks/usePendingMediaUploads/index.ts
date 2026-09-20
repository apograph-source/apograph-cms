import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@orthacms/design-system';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { mediaValueIds, toMediaValueRef } from '@orthacms/content-domain';
import type { EntryPresave } from '@orthacms/content-admin';
import { ROOT_FOLDER_ID, UPLOAD_CONCURRENCY } from '../../constants';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { mediaKeys } from '../../infrastructure/mediaKeys';
import type { MediaAsset } from '../../types/mediaAsset';
import type {
    MediaPendingUploads,
    PendingUpload
} from '../../types/pendingUpload';

/** Intl descriptors for the save-time upload step, co-located. */
const messages = defineMessages({
    failed: {
        id: 'media.pending.failed',
        defaultMessage:
            'Could not upload {name} — the record was not saved. Try again.'
    }
});

/** The id the media plugin's presave contribution is registered (and keyed) under. */
export const MEDIA_PRESAVE_ID = 'media.entry.presave';

/** Everything staged that the values actually still reference, in no order. */
function referenced(
    values: Record<string, unknown>,
    pending: ReadonlyMap<string, PendingUpload>
): PendingUpload[] {
    // Through the kernel: a media value is `{ id, alt?, decorative? }` as well
    // as a bare id since `ORT-83`, and reading only strings meant a staged file
    // attached to a field was no longer *referenced* by it — so the save
    // uploaded nothing and wrote a record pointing at a placeholder.
    const ids = new Set<string>();
    for (const value of Object.values(values))
        for (const id of mediaValueIds(value)) ids.add(id);
    return [...ids]
        .map((id) => pending.get(id))
        .filter((entry): entry is PendingUpload => !!entry);
}

/** Swap every placeholder id in the values for the asset it resolved to. */
function resolveValues(
    values: Record<string, unknown>,
    resolved: ReadonlyMap<string, string>
): Record<string, unknown> {
    if (resolved.size === 0) return values;
    const out: Record<string, unknown> = { ...values };

    /**
     * Swaps one value's placeholder for the real asset id, **keeping whatever
     * else the value carries** — the alt text and the decorative flag an author
     * typed against the staged file belong to the asset it became.
     */
    const swap = (item: unknown): { value: unknown; changed: boolean } => {
        const ref = toMediaValueRef(item);
        if (!ref) return { value: item, changed: false };
        const id = resolved.get(ref.id);
        if (!id) return { value: item, changed: false };
        return {
            // A bare id in, a bare id out: only widen the shape where the author
            // actually said something, so an untouched attach keeps the wire
            // form it had.
            value: typeof item === 'string' ? id : { ...ref, id },
            changed: true
        };
    };

    for (const [name, value] of Object.entries(values)) {
        if (Array.isArray(value)) {
            let changed = false;
            const next = value.map((item) => {
                const swapped = swap(item);
                if (swapped.changed) changed = true;
                return swapped.value;
            });
            if (changed) out[name] = next;
        } else {
            const swapped = swap(value);
            if (swapped.changed) out[name] = swapped.value;
        }
    }
    return out;
}

/**
 * The media plugin's contribution to the entry **save**: files chosen on a media
 * field are staged here and uploaded only when the record is saved or published.
 *
 * Why deferred — an upload is a write. Uploading the moment a file is picked
 * fills the Media Library with assets for a record the user then abandons, and a
 * media field is the one control where "I picked something" and "I saved" used
 * to mean two different write moments. Staging keeps the whole record one commit.
 *
 * A staged file gets a **placeholder uuid**, which is what the form value holds
 * ({@link PendingUpload}) — so client validation, the Changed badge, and the
 * publish gate treat it exactly like an attached asset. `commit` (run by
 * `ContentEntryView` before the write) uploads every staged file the values
 * still reference, `UPLOAD_CONCURRENCY` at a time, and returns the values with
 * the placeholders swapped for real asset ids. One failed file aborts the save
 * with a toast naming it; the files that did upload remember their asset id, so
 * a retry doesn't upload them twice.
 *
 * Mounted once per entry view through `ENTRY_PRESAVE_SLOT`, so the staging (and
 * its object-URL previews) survive the Media tab unmounting on a tab switch.
 */
export function usePendingMediaUploads(): EntryPresave {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<Map<string, PendingUpload>>(
        () => new Map()
    );
    // `commit` runs across awaits and after `settle`; it reads the map through a
    // ref so it never works from a render-stale copy.
    const pendingRef = useRef(pending);
    pendingRef.current = pending;

    const write = useCallback((next: Map<string, PendingUpload>) => {
        pendingRef.current = next;
        setPending(next);
    }, []);

    const stage = useCallback(
        (files: File[]) => {
            const next = new Map(pendingRef.current);
            const ids = files.map((file) => {
                const id = crypto.randomUUID();
                next.set(id, {
                    id,
                    file,
                    previewUrl: file.type.startsWith('image/')
                        ? URL.createObjectURL(file)
                        : undefined
                });
                return id;
            });
            write(next);
            return ids;
        },
        [write]
    );

    const drop = useCallback(
        (id: string) => {
            const entry = pendingRef.current.get(id);
            if (!entry) return;
            if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
            const next = new Map(pendingRef.current);
            next.delete(id);
            write(next);
        },
        [write]
    );

    const commit = useCallback(
        async ({ values }: { values: Record<string, unknown> }) => {
            const queue = referenced(values, pendingRef.current);
            if (queue.length === 0) return values;

            const resolved = new Map<string, string>();
            const uploaded = new Map<string, MediaAsset>();
            const failed: PendingUpload[] = [];

            // A small pool of workers over one shared cursor — the same shape as
            // the library's upload queue, minus the progress bookkeeping (the
            // save's busy cover is the status surface here).
            let cursor = 0;
            const worker = async () => {
                for (;;) {
                    const entry = queue[cursor++];
                    if (!entry) return;
                    if (entry.uploadedId) {
                        resolved.set(entry.id, entry.uploadedId);
                        continue;
                    }
                    try {
                        const asset = await httpMediaGateway.uploadFile(
                            ROOT_FOLDER_ID,
                            entry.file
                        );
                        resolved.set(entry.id, asset.id);
                        uploaded.set(entry.id, asset);
                    } catch {
                        failed.push(entry);
                    }
                }
            };
            await Promise.all(
                Array.from(
                    { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
                    worker
                )
            );

            if (uploaded.size > 0) {
                // The library gained assets even if the save is about to fail.
                queryClient.invalidateQueries({
                    queryKey: mediaKeys.all(workspace.id)
                });
                // Remember each asset id against its placeholder, so a retry
                // after a failed write attaches it instead of re-uploading.
                const next = new Map(pendingRef.current);
                for (const [placeholder, asset] of uploaded) {
                    const entry = next.get(placeholder);
                    if (entry)
                        next.set(placeholder, {
                            ...entry,
                            uploadedId: asset.id
                        });
                }
                write(next);
            }

            if (failed.length > 0) {
                for (const entry of failed) {
                    toast.error(
                        intl.formatMessage(messages.failed, {
                            name: entry.file.name
                        })
                    );
                }
                throw new Error('media upload failed');
            }

            return resolveValues(values, resolved);
        },
        [intl, queryClient, workspace.id, write]
    );

    /** The write landed — the saved record carries the ids, so drop the staging. */
    const settle = useCallback(() => {
        for (const entry of pendingRef.current.values()) {
            if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
        }
        write(new Map());
    }, [write]);

    // Leaving the editor with files still staged would otherwise leak every
    // preview blob for the tab's life.
    useEffect(
        () => () => {
            // Read through the ref *inside* the cleanup — the map at mount time
            // is always the empty one.
            for (const entry of pendingRef.current.values()) {
                if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
            }
        },
        []
    );

    const handle: MediaPendingUploads = { pending, stage, drop };
    return { commit, settle, handle };
}
