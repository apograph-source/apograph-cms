import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
    ContentTypeDetail,
    EntryRecord
} from '../../domain/types/contentType';
import { usePublishEntryFlow, type SubmitEntryInput } from './index';

/**
 * The save/publish use case, at the one seam the review rules depend on: whether
 * a Publish **saves first**.
 *
 * Every save appends a version, and a review approval is bound to a version. So
 * the two invariants pinned here are protection's, stated where the decision is
 * made (`docs/design/protection.md`): an unchanged record publishes without a
 * save (I-19), and a publish guard's bypass rides whichever request actually
 * publishes, after the save when there is one (I-20). Content does not know that
 * protection exists — which is why only a test here can hold it to either.
 */

const calls = vi.hoisted(() => ({ order: [] as string[] }));

const save = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    isPending: false
}));
const publish = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    isPending: false
}));

vi.mock('../useSaveEntry', () => ({ useSaveEntry: () => save }));
vi.mock('../useEntryStatusActions', () => ({
    useEntryStatusActions: () => ({
        publish,
        unpublish: { mutateAsync: vi.fn(), isPending: false },
        remove: { mutateAsync: vi.fn(), isPending: false }
    })
}));
vi.mock('../refreshEntryCaches', () => ({
    refreshEntryCaches: () => Promise.resolve()
}));
vi.mock('@ortha/workspaces-admin', () => ({
    useCurrentWorkspace: () => ({ id: 'ws-1', name: 'Docs' })
}));

/** No fields, so the kernel's publish gate has nothing to refuse. */
const SCHEMA = {
    name: 'article',
    label: 'Articles',
    kind: 'collection',
    publishable: true,
    fields: []
} as unknown as ContentTypeDetail;

const ENTRY = {
    id: 'entry-1',
    status: 'draft',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    values: {}
} as unknown as EntryRecord;

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient()}>
            {children}
        </QueryClientProvider>
    );
}

function submit(input: Partial<SubmitEntryInput>) {
    const { result } = renderHook(() => usePublishEntryFlow('article'), {
        wrapper
    });
    return act(() =>
        result.current.submit({
            schema: SCHEMA,
            publishable: true,
            values: {},
            publish: true,
            ...input
        })
    );
}

beforeEach(() => {
    calls.order = [];
    save.mutateAsync.mockReset().mockImplementation(async () => {
        calls.order.push('save');
        return { ...ENTRY, id: ENTRY.id };
    });
    publish.mutateAsync.mockReset().mockImplementation(async () => {
        calls.order.push('publish');
        return { ...ENTRY, status: 'published' };
    });
});

describe('usePublishEntryFlow — publishing an unchanged record [protection:I-19]', () => {
    it('publishes a saved, unchanged record without saving it', async () => {
        const result = await submit({ entry: ENTRY, unchanged: true });

        expect(calls.order).toEqual(['publish']);
        expect(publish.mutateAsync).toHaveBeenCalledWith({
            id: 'entry-1',
            bypass: undefined
        });
        expect(result).toMatchObject({ published: true, wasCreate: false });
    });

    it('saves first whenever the record is not unchanged', async () => {
        await submit({ entry: ENTRY, unchanged: false });

        expect(calls.order).toEqual(['save', 'publish']);
    });

    /** Nothing is stored yet, so "unchanged" cannot mean there is nothing to write. */
    it('always creates on a create form, whatever it is told', async () => {
        const result = await submit({ entry: undefined, unchanged: true });

        expect(calls.order).toEqual(['save', 'publish']);
        expect(result).toMatchObject({ wasCreate: true });
    });

    it('never skips the save on a draft save, which publishes nothing', async () => {
        await submit({ entry: ENTRY, unchanged: true, publish: false });

        expect(calls.order).toEqual(['save']);
    });
});

describe('usePublishEntryFlow — a guard’s bypass [protection:I-20]', () => {
    it('sends the bypass with the publish that follows the save', async () => {
        await submit({
            entry: ENTRY,
            unchanged: false,
            bypass: true
        });

        expect(calls.order).toEqual(['save', 'publish']);
        expect(publish.mutateAsync).toHaveBeenCalledWith({
            id: 'entry-1',
            bypass: true
        });
        // The bypass is the publish's business, never the save's.
        expect(save.mutateAsync.mock.calls[0][0]).not.toHaveProperty('bypass');
    });

    it('sends the bypass with the only request an unchanged record makes', async () => {
        await submit({
            entry: ENTRY,
            unchanged: true,
            bypass: true
        });

        expect(publish.mutateAsync).toHaveBeenCalledWith({
            id: 'entry-1',
            bypass: true
        });
    });

    it('publishes the record a create form just wrote, with the bypass', async () => {
        save.mutateAsync.mockImplementation(async () => {
            calls.order.push('save');
            return { ...ENTRY, id: 'entry-new' };
        });

        await submit({ entry: undefined, bypass: true });

        expect(publish.mutateAsync).toHaveBeenCalledWith({
            id: 'entry-new',
            bypass: true
        });
    });
});
