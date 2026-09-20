import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WYSIWYG_MEDIA_KIND } from '@orthacms/wysiwyg-admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '../../types/mediaAsset';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { WysiwygUploadSource } from './index';

vi.mock('../../infrastructure/httpMediaGateway', () => ({
    httpMediaGateway: { uploadFile: vi.fn() }
}));

vi.mock('@orthacms/design-system', () => ({
    toast: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: 'ws-1', name: 'Alpha', slug: 'a' })
}));

/** The files the stub dialog hands back when "Upload and insert" is pressed. */
let staged: File[] = [];

/**
 * The picker itself is not the subject — what is, is what happens between the
 * files being chosen and the editor being handed something. The real dialog
 * needs a file input, a drop zone and the design system's `Dialog`, none of
 * which change the answer.
 */
vi.mock('../UploadDialog', () => ({
    UploadDialog: ({
        onUpload
    }: {
        onUpload: (uploads: { file: File }[]) => void;
    }) => (
        <button
            type="button"
            onClick={() => onUpload(staged.map((file) => ({ file })))}
        >
            Upload and insert
        </button>
    )
}));

const uploadFile = vi.mocked(httpMediaGateway.uploadFile);

const png = (name: string) => new File(['bytes'], name, { type: 'image/png' });

const uploadedAsset = (name: string): MediaAsset => ({
    id: `asset-${name}`,
    name,
    kind: 'image',
    url: `/api/media/assets/asset-${name}/raw`,
    previewUrl: `/api/media/assets/asset-${name}/raw?variant=preview`,
    mimeType: 'image/png',
    size: 5,
    folderId: 'root',
    tags: [],
    uploadedBy: 'Ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
});

function renderSource(onInsert = vi.fn()) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
        <IntlProvider locale="en">
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </IntlProvider>
    );

    render(
        <WysiwygUploadSource
            open
            onOpenChange={vi.fn()}
            accept={[WYSIWYG_MEDIA_KIND.Image, WYSIWYG_MEDIA_KIND.Video]}
            onInsert={onInsert}
        />,
        { wrapper }
    );

    return { onInsert };
}

beforeEach(() => {
    vi.clearAllMocks();
    staged = [];
});

/**
 * The rich-text editor's upload source, and the one thing that makes it
 * different from the media *field* beside it.
 *
 * A field holds an asset **id**, so it can stage a file and defer the upload to
 * the record's save — an abandoned edit then litters nothing. A body holds a
 * **URL**, and there is no URL until the bytes exist. Deferring here would mean
 * writing a placeholder into the document and hoping to rewrite it later; a
 * body saved, previewed or copied in between would carry a link to nothing.
 *
 * So the sequence is the invariant: bytes first, URL second, insert third —
 * with no save anywhere in it.
 */
describe('WysiwygUploadSource', () => {
    // covers: media:I-39
    it('uploads the file and inserts the URL it came back with, with no save in between', async () => {
        staged = [png('diagram.png')];
        uploadFile.mockResolvedValue(uploadedAsset('diagram.png'));
        const { onInsert } = renderSource();

        fireEvent.click(
            screen.getByRole('button', { name: 'Upload and insert' })
        );

        // The bytes went to the library the moment the file was chosen —
        // nothing else was pressed, and there is no record to save here.
        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
        expect(uploadFile).toHaveBeenCalledWith('root', staged[0]);

        await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
        expect(onInsert).toHaveBeenCalledWith([
            {
                kind: WYSIWYG_MEDIA_KIND.Image,
                src: '/api/media/assets/asset-diagram.png/raw?variant=preview'
            }
        ]);
    });

    // covers: media:I-39
    it('inserts nothing for a file whose bytes never landed', async () => {
        // The discriminating case. An implementation that put a local
        // placeholder in the body and uploaded afterwards would insert
        // something here — a body pointing at a blob URL that dies with the
        // tab. Nothing is inserted, because there is no URL to insert.
        staged = [png('broken.png'), png('fine.png')];
        uploadFile
            .mockRejectedValueOnce(new Error('storage down'))
            .mockResolvedValueOnce(uploadedAsset('fine.png'));
        const { onInsert } = renderSource();

        fireEvent.click(
            screen.getByRole('button', { name: 'Upload and insert' })
        );

        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
        // One request each, and exactly one insert: the failure cost its own
        // file and nothing else.
        await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
        expect(onInsert).toHaveBeenCalledWith([
            expect.objectContaining({
                src: '/api/media/assets/asset-fine.png/raw?variant=preview'
            })
        ]);
    });

    it('never sends a file the editor has no node for', async () => {
        // A PDF would upload fine and then be silently unusable, which reads
        // as the editor losing the file.
        staged = [
            new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })
        ];
        const { onInsert } = renderSource();

        fireEvent.click(
            screen.getByRole('button', { name: 'Upload and insert' })
        );

        await waitFor(() => expect(onInsert).not.toHaveBeenCalled());
        expect(uploadFile).not.toHaveBeenCalled();
    });
});
