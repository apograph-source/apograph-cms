import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import type { SegmentResolver } from '@orthacms/segments-domain';
import { SegmentCatalogService } from '@orthacms/segments-server';

/** The header the harness's reader resolver reads. */
export const READER_TAGS_HEADER = 'x-reader-tags';

/**
 * The harness's reader resolver: a comma-separated `X-Reader-Tags` header.
 *
 * A real deployment writes exactly this shape — the port hands over the Express
 * request precisely so a JWT claim or a header the CDN sets is reachable — so
 * driving it from a header is the production seam, not a test hook bolted
 * beside it. A request with no header resolves to the **anonymous** reader,
 * which is the state every public request is in until an operator configures
 * something, and the one the read scope must be safe in.
 *
 * It never throws, per the port's contract: a resolver that fell over would
 * take the site down over content most readers can see anyway.
 */
export const headerSegmentResolver: SegmentResolver<Request> = {
    resolve: async (request) => {
        const raw = request.headers[READER_TAGS_HEADER];
        const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
        return value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
    }
};

/**
 * Re-read the segment catalogue from the database.
 *
 * The catalogue is held **in memory** — the read scope is consulted inside the
 * query builder and cannot await — and reloaded only by writes that go through
 * `SegmentsService`. `resetDb` truncates the tables behind its back, so without
 * this a suite would boot each test with a catalogue still holding the previous
 * one's segments: `configured` stays true, and ids that no longer exist keep
 * validating. Call it right after `resetDb` in any suite that touches segments.
 */
export async function reloadSegmentCatalogue(
    app: INestApplication
): Promise<void> {
    await app.get(SegmentCatalogService).reload();
}
