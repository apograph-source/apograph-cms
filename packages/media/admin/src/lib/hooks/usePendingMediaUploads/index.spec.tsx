import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '../../types/mediaAsset';
import type { MediaPendingUploads } from '../../types/pendingUpload';
import { httpMediaGateway } from '../../infrastructure/httpMediaGateway';
import { usePendingMediaUploads } from './index';

vi.mock('../../infrastructure/httpMediaGateway', () => ({
    httpMediaGateway: { uploadFile: vi.fn() }
}));

vi.mock('@orthacms/design-system', () => ({
    toast: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: 'ws-1', name: 'Alpha', slug: 'a' })
}));

const uploadFile = vi.mocked(httpMediaGateway.uploadFile);

const png = (name: string) => new File(['bytes'], name, { type: 'image/png' });

const asset = (id: string): MediaAsset => ({
    id,
    name: `${id}.png`,
    kind: 'image',
    url: `/api/media/assets/${id}/raw`,
    mimeType: 'image/png',
    size: 5,
    folderId: 'root',
    tags: [],
    uploadedBy: 'Ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
});

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom implements neither, and `stage` mints a preview for every image.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
});

/**
 * `EntryPresave.handle` is deliberately `unknown` — the slot contract says a
 * tab reads only its own key — so the media side names its own shape here.
 */
const staging = (handle: unknown) => handle as MediaPendingUploads;

function mounted() {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <IntlProvider locale="en">
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </IntlProvider>
    );
    return renderHook(() => usePendingMediaUploads(), { wrapper });
}

/**
 * The presave step that makes "choose a file" and "save the record" one commit.
 *
 * `media-fields.spec.ts` pins the deferral itself in a browser — the upload spy
 * stays at zero until Save. What it does not reach are the two clauses that
 * only exist because the upload and the write can disagree: a save whose upload
 * step failed must write nothing, and the retry after one must not send the
 * bytes that already landed a second time. Both are about state carried across
 * two calls of `commit`, which is awkward to drive through a page and direct
 * here.
 */
describe('usePendingMediaUploads', () => {
    // covers: media:I-38
    it('aborts the save when a file fails, leaving the values alone', async () => {
        const { result } = mounted();

        let ids: string[] = [];
        act(() => {
            ids = staging(result.current.handle).stage([png('a'), png('b')]);
        });
        const values = { gallery: ids };

        // The first file lands; the second does not. A save that returned the
        // partially-resolved values would write a record pointing at one real
        // asset and one placeholder that will never exist.
        uploadFile
            .mockResolvedValueOnce(asset('asset-a'))
            .mockRejectedValueOnce(new Error('storage down'));

        await act(async () => {
            await expect(
                result.current.commit({ values, publish: false })
            ).rejects.toThrow();
        });
        expect(values.gallery).toEqual(ids);
    });

    // covers: media:I-38
    it('does not upload a second time what a failed save already sent', async () => {
        const { result } = mounted();

        let ids: string[] = [];
        act(() => {
            ids = staging(result.current.handle).stage([png('a'), png('b')]);
        });
        const values = { gallery: ids };

        uploadFile
            .mockResolvedValueOnce(asset('asset-a'))
            .mockRejectedValueOnce(new Error('storage down'));
        await act(async () => {
            await expect(
                result.current.commit({ values, publish: false })
            ).rejects.toThrow();
        });

        // The user fixes whatever broke and saves again.
        uploadFile.mockResolvedValueOnce(asset('asset-b'));
        let resolved: Record<string, unknown> = {};
        await act(async () => {
            resolved = await result.current.commit({ values, publish: false });
        });

        // Three calls in total, not four: `a` is remembered by its asset id and
        // skipped, so the library gains one copy of it rather than two.
        expect(uploadFile).toHaveBeenCalledTimes(3);
        const sentNames = uploadFile.mock.calls.map(
            ([, file]) => (file as File).name
        );
        expect(sentNames).toEqual(['a', 'b', 'b']);

        // And the retry still resolves both placeholders — a skip that dropped
        // the id would write the record pointing at a placeholder.
        expect(resolved.gallery).toEqual(['asset-a', 'asset-b']);
    });
});
