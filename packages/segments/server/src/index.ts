/**
 * Public API of `@orthacms/segments-server` — reader entitlements, enforced on
 * the public content API.
 *
 * The whole feature is two tables and one predicate: a segment is a named set
 * of reader tags, an entry names the segments it admits and the segments it
 * refuses, and every public read is AND-ed with the question "does this reader
 * pass those two lists".
 */

export { SegmentsPlugin } from './lib/utils/segments-plugin';
export { SegmentsModule } from './lib/segments.module';
export { SEGMENTS_CONFIG } from './lib/segments.tokens';
export type { SegmentsPluginConfig } from './lib/types/segments-config';

// The catalogue and the reader, for a host that wants to answer "who is
// reading" from its own code — a preview route, a custom protocol.
export { SegmentCatalogService } from './lib/application/segment-catalog.service';
export { ReaderStore } from './lib/application/reader.store';
export type { Reader } from './lib/application/reader.store';

// The write path, so another plugin can set an entry's access as part of its
// own operation (an import, a bulk action) rather than through HTTP.
export { EntryAccessService } from './lib/application/entry-access.service';
export type { EntryAccessView } from './lib/application/entry-access.service';
export type { SegmentView } from './lib/application/segments.service';

// The tables, for a host assembling its own Drizzle schema.
export { segments, entryAccess } from './lib/schema';
