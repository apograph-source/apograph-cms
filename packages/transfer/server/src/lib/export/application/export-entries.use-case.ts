/**
 * Turning a walk into a downloadable file.
 *
 * The split with `EntryGraphWalker` is deliberate: the walker knows the content
 * graph and nothing about formats, this knows formats and nothing about the
 * graph. Adding XLSX later touches neither.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { Readable } from 'node:stream';
import { STORAGE_PROVIDER, type StorageProvider } from '@ortha/media-server';
import type { AnyContentType } from '@ortha/content-server';
import {
    TRANSFER_FORMAT,
    TRANSFER_FORMAT_CAPABILITIES,
    TRANSFER_FORMAT_VERSION,
    serializerFor,
    type TransferDepth,
    type TransferDocument,
    type TransferFormat
} from '@ortha/transfer-domain';
import { createZipStream, type ZipMember } from '../../archive/zip-writer';
import { TransferSchemaCatalog } from '../../schema/schema-catalog.service';
import {
    EntryGraphWalker,
    type WalkedAsset,
    type WalkResult
} from '../infrastructure/entry-graph.walker';

/** What to export. */
export interface ExportCommand {
    type: AnyContentType;
    ids: readonly string[];
    workspaceId: string;
    format: TransferFormat;
    depth: TransferDepth;
}

/** A ready-to-stream download. */
export interface ExportDownload {
    filename: string;
    mimeType: string;
    body: Readable;
    /** What the walk found, for the audit record and the response headers. */
    result: WalkResult;
}

@Injectable()
export class ExportEntriesUseCase {
    constructor(
        private readonly walker: EntryGraphWalker,
        private readonly catalog: TransferSchemaCatalog,
        // Absent without the media plugin; an export then carries metadata for
        // media fields but no bytes, rather than refusing to run.
        @Optional()
        @Inject(STORAGE_PROVIDER)
        private readonly storage?: StorageProvider
    ) {}

    async execute(command: ExportCommand): Promise<ExportDownload> {
        const result = await this.walker.walk({
            type: command.type,
            ids: command.ids,
            workspaceId: command.workspaceId,
            depth: command.depth
        });

        const document: TransferDocument = {
            manifest: {
                version: TRANSFER_FORMAT_VERSION,
                exportedAt: new Date().toISOString(),
                sourceWorkspaceId: command.workspaceId,
                rootType: command.type.name,
                depth: command.depth,
                identity: this.catalog.identityMap(),
                counts: result.counts
            },
            records: result.records
        };

        const files = serializerFor(command.format).serialize(document, {
            schemas: this.catalog.schemas(),
            identityFieldsOf: (type) => this.catalog.identityFieldsOf(type)
        });
        const capabilities = TRANSFER_FORMAT_CAPABILITIES[command.format];

        // One text member and no bytes to carry: stream it directly rather than
        // wrapping a single file in an archive nobody asked for.
        const carriesAssets =
            capabilities.carriesFileBytes &&
            command.depth.media &&
            result.assets.size > 0;
        if (files.length === 1 && !carriesAssets) {
            return {
                filename: `${command.type.name}-${stamp()}.${capabilities.extension}`,
                mimeType: capabilities.mimeType,
                body: Readable.from([Buffer.from(files[0].text, 'utf8')]),
                result
            };
        }

        // Everything else is an archive: several CSVs, or a ZIP with bytes.
        const members = this.archiveMembers(files, result, carriesAssets);
        return {
            filename: `${command.type.name}-${stamp()}.zip`,
            mimeType:
                TRANSFER_FORMAT_CAPABILITIES[TRANSFER_FORMAT.Zip].mimeType,
            body: createZipStream(members),
            result
        };
    }

    /**
     * The archive's members, yielded lazily.
     *
     * An asset's storage stream is opened only when the writer reaches it, so a
     * thousand-asset export never holds a thousand open reads — the whole
     * reason the members are an async iterable rather than an array.
     */
    private async *archiveMembers(
        files: readonly { path: string; text: string }[],
        result: WalkResult,
        carriesAssets: boolean
    ): AsyncGenerator<ZipMember> {
        for (const file of files) {
            yield { path: file.path, body: Buffer.from(file.text, 'utf8') };
        }
        if (!carriesAssets || !this.storage) return;

        for (const asset of result.assets.values()) {
            const body = await this.openAsset(asset);
            // A missing object is a gap in the archive, not a failed export:
            // the record still names the asset, and the import reports it as a
            // missing file. Refusing the whole download because one blob was
            // pruned would be the worse trade.
            if (body) yield { path: asset.path, body };
        }
    }

    private async openAsset(
        asset: WalkedAsset
    ): Promise<NodeJS.ReadableStream | undefined> {
        if (!this.storage) return undefined;
        try {
            return await this.storage.get(asset.storageKey);
        } catch {
            return undefined;
        }
    }
}

/**
 * `YYYYMMDD-HHmmss` in UTC — enough to keep two exports of the same collection
 * from overwriting each other in a downloads folder.
 */
function stamp(): string {
    return new Date()
        .toISOString()
        .replace(/[:-]/g, '')
        .replace('T', '-')
        .slice(0, 15);
}
