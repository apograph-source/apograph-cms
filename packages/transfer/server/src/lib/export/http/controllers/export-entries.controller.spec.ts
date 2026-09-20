import { Readable, Writable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { DomainEvent, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type {
    AnyContentType,
    ContentTypeRegistry
} from '@orthacms/content-server';
import type { PublicUser } from '@orthacms/identity-server';
import { TRANSFER_FORMAT } from '@orthacms/transfer-domain';
import type {
    ExportDownload,
    ExportEntriesUseCase
} from '../../application/export-entries.use-case';
import type { ExportPreviewQuery } from '../../application/export-preview.query';
import { ExportEntriesController } from './export-entries.controller';
import type { ExportRequestDto } from '../dto/export-request.dto';

const TYPE = { name: 'post' } as unknown as AnyContentType;

/**
 * A response that records **when** its first byte was written.
 *
 * The whole invariant is an ordering, and an ordering is only observable if
 * something notices both ends of it. `journal` below is that something: the
 * audit append and the first chunk push into the same list, in the order they
 * really happen.
 */
function fakeResponse(journal: string[]) {
    const headers: Record<string, string> = {};
    const chunks: Buffer[] = [];
    const response = new Writable({
        write(chunk, _encoding, callback) {
            if (chunks.length === 0) journal.push('first-byte');
            chunks.push(Buffer.from(chunk));
            callback();
        }
    }) as Writable & Partial<Response>;
    response.setHeader = ((name: string, value: string) => {
        headers[name] = String(value);
        return response as Response;
    }) as Response['setHeader'];
    return { response: response as unknown as Response, headers, chunks };
}

function harness(journal: string[], user?: PublicUser) {
    const events: DomainEvent[] = [];
    const download: ExportDownload = {
        filename: 'post-20260101-000000.json',
        mimeType: 'application/json',
        body: Readable.from([
            Buffer.from('{"manifest":'),
            Buffer.from('{},"records":[]}')
        ]),
        result: {
            records: [
                {
                    $type: 'post',
                    $id: 'row-1',
                    $key: {},
                    $depth: 0,
                    values: {},
                    relations: {},
                    media: []
                }
            ],
            assets: new Map(),
            counts: { roots: 1, related: 2, assets: 0, assetBytes: 0 }
        }
    };

    const controller = new ExportEntriesController(
        {
            get: (name: string) => (name === 'post' ? TYPE : undefined)
        } as unknown as ContentTypeRegistry,
        {
            execute: async (): Promise<ExportDownload> => download
        } as unknown as ExportEntriesUseCase,
        {} as unknown as ExportPreviewQuery,
        {
            run: async <T>(fn: () => Promise<T>): Promise<T> => fn()
        } as unknown as UnitOfWork,
        {
            append: async (appended: DomainEvent[]): Promise<void> => {
                journal.push('audit');
                events.push(...appended);
            }
        } as unknown as OutboxWriter
    );

    const body = {
        ids: ['row-1'],
        format: TRANSFER_FORMAT.Json
    } as ExportRequestDto;

    return { controller, body, events, user };
}

describe('the export audit event', () => {
    it('is written before the response streams a byte [transfer:I-34]', async () => {
        // A download interrupted halfway still moved data. Recording only what
        // completed would leave the most interesting case — the one that
        // failed partway — with no trace at all, which is precisely the case an
        // operator goes looking for afterwards.
        const journal: string[] = [];
        const { controller, body } = harness(journal);
        const { response, chunks } = fakeResponse(journal);

        await controller.export('post', body, 'ws-1', response);

        expect(journal[0]).toBe('audit');
        expect(journal).toContain('first-byte');
        // Guards the ordering above: a body that never streamed would put
        // 'audit' first for the wrong reason.
        expect(Buffer.concat(chunks).toString()).toBe(
            '{"manifest":{},"records":[]}'
        );
    });

    it('names who took what, and how much of it [transfer:I-34]', async () => {
        const journal: string[] = [];
        const user = {
            id: 'user-1',
            email: 'ada@example.test'
        } as unknown as PublicUser;
        const { controller, body, events } = harness(journal);
        const { response } = fakeResponse(journal);

        await controller.export('post', body, 'ws-1', response, user);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'transfer.content.exported',
            aggregateType: 'transfer.content',
            aggregateId: 'post',
            payload: {
                workspaceId: 'ws-1',
                format: 'json',
                selected: 1,
                roots: 1,
                related: 2,
                actor: { id: 'user-1', email: 'ada@example.test' }
            }
        });
    });

    it('is written for a caller with no session user too [transfer:I-34]', async () => {
        // An API-token export is still bulk extraction; an unattributed event
        // beats none.
        const journal: string[] = [];
        const { controller, body, events } = harness(journal);
        const { response } = fakeResponse(journal);

        await controller.export('post', body, 'ws-1', response);

        expect(journal[0]).toBe('audit');
        expect(events[0].payload['actor']).toBeUndefined();
    });
});

describe('the download response', () => {
    it('carries the filename, the count and a no-sniff header', async () => {
        const journal: string[] = [];
        const { controller, body } = harness(journal);
        const { response, headers } = fakeResponse(journal);

        await controller.export('post', body, 'ws-1', response);

        expect(headers).toEqual({
            'Content-Type': 'application/json',
            'Content-Disposition':
                'attachment; filename="post-20260101-000000.json"',
            'X-Transfer-Records': '1',
            'X-Content-Type-Options': 'nosniff'
        });
    });

    it('refuses an unknown content type before anything is audited', async () => {
        const journal: string[] = [];
        const { controller, body, events } = harness(journal);
        const { response } = fakeResponse(journal);

        await expect(
            controller.export('widget', body, 'ws-1', response)
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(events).toEqual([]);
    });
});
