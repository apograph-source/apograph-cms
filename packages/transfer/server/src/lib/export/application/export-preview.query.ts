/**
 * The export dry run: how big would this be?
 *
 * It exists because the depth toggles are not intuitive until you see what they
 * cost. "Include related records" reads as harmless; on a well-linked
 * collection it can be the difference between 40 records and 4,000, and the
 * only honest way to say so is to count. The dialog shows this live as the
 * toggles move, which turns a limit error after a long wait into a number
 * before the click.
 *
 * It runs the same walk the export does and throws away the records, which is
 * the point: a preview computed a cheaper way would eventually disagree with
 * the thing it is previewing.
 */

import { Injectable } from '@nestjs/common';
import type { AnyContentType } from '@orthacms/content-server';
import {
    TRANSFER_FORMAT_CAPABILITIES,
    type TransferCounts,
    type TransferDepth,
    type TransferFormat
} from '@orthacms/transfer-domain';
import { EntryGraphWalker } from '../infrastructure/entry-graph.walker';

/** What a preview reports. */
export interface ExportPreview extends TransferCounts {
    /**
     * Whether the chosen format will actually carry the bytes counted in
     * {@link TransferCounts.assetBytes}. False for every format but the
     * archive — so the dialog can say "9 files (metadata only)" rather than
     * implying a download that size.
     */
    carriesFileBytes: boolean;
}

@Injectable()
export class ExportPreviewQuery {
    constructor(private readonly walker: EntryGraphWalker) {}

    async preview(
        type: AnyContentType,
        ids: readonly string[],
        workspaceId: string,
        depth: TransferDepth,
        format: TransferFormat
    ): Promise<ExportPreview> {
        const result = await this.walker.walk({
            type,
            ids,
            workspaceId,
            depth
        });
        return {
            ...result.counts,
            carriesFileBytes:
                TRANSFER_FORMAT_CAPABILITIES[format].carriesFileBytes &&
                depth.media
        };
    }
}
