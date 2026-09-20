import { useCallback, useRef, useState } from 'react';
import { apiClient } from '@orthacms/utils-admin';
import type { ChatAttachment } from '../domain/types/chat';

/**
 * Files one turn may carry. Mirrors the server's `MAX_RUN_ATTACHMENTS`, checked
 * here as well so the twelfth file is refused with a sentence in the composer
 * rather than a 400 after eleven uploads have already landed in the library.
 */
export const MAX_ATTACHMENTS = 8;

/** One staged file, from the moment it is dropped to the moment it is sent. */
export interface StagedAttachment {
    /** Stable local key — the chip's React key and what `remove` addresses. */
    id: string;
    /** The file's name, shown while it uploads and after. */
    name: string;
    /** Size in bytes, as reported by the browser. */
    size: number;
    /** `uploading` until the asset exists, then `ready`, or `failed`. */
    status: 'uploading' | 'ready' | 'failed';
    /** 0–100 while uploading. */
    progress: number;
    /** The created asset, once the upload landed. */
    asset?: ChatAttachment;
    /** Why the upload failed, when it did. */
    error?: string;
}

/** The asset view the media upload route returns — the fields a chip needs. */
interface UploadedAsset {
    id: string;
    name: string;
    mimeType: string;
    kind: string;
    size: number;
}

/** What the composer needs to stage, show and clear attachments. */
export interface ComposerAttachments {
    /** Everything staged, in the order it was added. */
    items: StagedAttachment[];
    /**
     * The ones that uploaded, in the shape a turn carries. A staged file that
     * failed is simply absent — the chip has already said so, and sending a
     * broken reference would fail the whole run over one file.
     */
    sent: ChatAttachment[];
    /** True while any upload is still in flight — the send button waits on it. */
    uploading: boolean;
    /** Stages and uploads files. Silently ignores an empty list. */
    add(files: FileList | readonly File[]): void;
    /** Drops one staged file. Does **not** delete the uploaded asset. */
    remove(id: string): void;
    /** Clears everything — called once a turn has been sent. */
    clear(): void;
    /** Set when the last `add` was refused, e.g. over the count limit. */
    error: string | null;
}

/**
 * Stages files for the next turn, uploading each to the media library as it is
 * added.
 *
 * **The upload does not go through the copilot.** It is an ordinary
 * `POST /api/media/assets` on the user's own session, carrying their own
 * `media:create` — the same request the Media Library page makes, from a
 * different button. That is the whole reason attachments needed no new
 * authority: by the time a run starts, the file already exists and the request
 * only names it. A user who cannot upload to the library cannot attach a file
 * to a chat either, which is the correct answer rather than a special case.
 *
 * It also means an attachment is a **permanent, searchable library asset**
 * rather than a blob that lives and dies inside a conversation — findable by
 * `media_assets_search` in a later thread, attachable to a content record, and
 * subject to the same retention as anything else.
 *
 * Uploading happens on `add` rather than on send, so the wait is spent while
 * the person is still typing, and a file that will be rejected is rejected
 * before they have written a question about it.
 */
export function useComposerAttachments(): ComposerAttachments {
    const [items, setItems] = useState<StagedAttachment[]>([]);
    const [error, setError] = useState<string | null>(null);
    // A counter, not `Date.now()`: several files dropped together land in the
    // same millisecond and would share a React key.
    const nextId = useRef(0);
    // The list as of *now*, readable synchronously. `add` has to know how many
    // files are already staged before it decides how many more fit, and it
    // cannot do that arithmetic inside a `setItems` updater: React invokes an
    // updater twice under StrictMode, which would advance the id counter twice
    // per file and pair every upload with the wrong chip.
    const itemsRef = useRef<StagedAttachment[]>([]);

    /** The single writer — keeps the ref and the rendered state in lockstep. */
    const write = useCallback(
        (next: (current: StagedAttachment[]) => StagedAttachment[]) => {
            itemsRef.current = next(itemsRef.current);
            setItems(itemsRef.current);
        },
        []
    );

    /** Merge a patch into one staged file, leaving the rest untouched. */
    const patch = useCallback(
        (id: string, next: Partial<StagedAttachment>) => {
            write((current) =>
                current.map((item) =>
                    item.id === id ? { ...item, ...next } : item
                )
            );
        },
        [write]
    );

    const add = useCallback(
        (files: FileList | readonly File[]) => {
            const incoming = Array.from(files);
            if (incoming.length === 0) {
                return;
            }

            // Room is measured against what is already staged, and the overflow
            // is dropped rather than the whole batch refused — someone dropping
            // a folder of twenty files still gets the first eight.
            const room = Math.max(MAX_ATTACHMENTS - itemsRef.current.length, 0);
            const accepted = incoming.slice(0, room);
            setError(
                accepted.length < incoming.length
                    ? `Only ${MAX_ATTACHMENTS} files can be attached to one message.`
                    : null
            );
            if (accepted.length === 0) {
                return;
            }

            const staged = accepted.map((file) => ({
                id: `staged-${nextId.current++}`,
                name: file.name,
                size: file.size,
                status: 'uploading' as const,
                progress: 0
            }));
            write((current) => [...current, ...staged]);

            accepted.forEach((file, offset) => {
                void upload(file, staged[offset].id);
            });

            async function upload(file: File, id: string) {
                const form = new FormData();
                form.append('file', file);
                try {
                    const response = await apiClient.post<UploadedAsset>(
                        '/media/assets',
                        form,
                        {
                            onUploadProgress: (event) => {
                                if (!event.total) {
                                    return;
                                }
                                patch(id, {
                                    progress: Math.round(
                                        (event.loaded / event.total) * 100
                                    )
                                });
                            }
                        }
                    );
                    const asset = response.data;
                    patch(id, {
                        status: 'ready',
                        progress: 100,
                        name: asset.name,
                        asset: {
                            assetId: asset.id,
                            name: asset.name,
                            mimeType: asset.mimeType,
                            kind: asset.kind,
                            size: asset.size,
                            // The server decides this and sends it back with
                            // the run's own attachment refs; the chip only
                            // needs a hint, and guessing here would be a second
                            // copy of the allowlist.
                            readable: false
                        }
                    });
                } catch (failure) {
                    patch(id, {
                        status: 'failed',
                        error: uploadMessage(failure)
                    });
                }
            }
        },
        [patch, write]
    );

    const remove = useCallback(
        (id: string) => {
            // The uploaded asset is deliberately left in the library.
            // Removing a chip means "don't send this with my message", not
            // "delete my file" — the library is where a deletion is meant to
            // be made, deliberately and with the rest of the folder in view.
            write((current) => current.filter((item) => item.id !== id));
            setError(null);
        },
        [write]
    );

    const clear = useCallback(() => {
        write(() => []);
        setError(null);
    }, [write]);

    return {
        items,
        sent: items
            .map((item) => item.asset)
            .filter((asset): asset is ChatAttachment => asset !== undefined),
        uploading: items.some((item) => item.status === 'uploading'),
        add,
        remove,
        clear,
        error
    };
}

/** The server's reason for refusing an upload, when it gave a readable one. */
function uploadMessage(error: unknown): string {
    const response = (
        error as {
            response?: { status?: number; data?: { message?: unknown } };
        }
    ).response;
    const message = response?.data?.message;
    if (typeof message === 'string') {
        return message;
    }
    if (Array.isArray(message)) {
        return message.join('; ');
    }
    // The one status worth naming: the file was larger than the deployment's
    // upload ceiling, which is a thing the person can act on.
    if (response?.status === 413) {
        return 'That file is too large to upload.';
    }
    return 'The upload failed.';
}
