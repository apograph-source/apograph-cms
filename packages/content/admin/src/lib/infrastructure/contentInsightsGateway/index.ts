/**
 * The content Insights read models, restated from the server's view contracts.
 *
 * Restated rather than imported: the admin can't reach across the app boundary
 * into `@orthacms/content-server`, exactly as it restates every other wire type
 * in this package.
 */

/** A single point on a time series. */
export type InsightsSeriesPoint = {
    /** Bucket start, `YYYY-MM-DD`. */
    bucket: string;
    /** Measured value for the bucket. */
    value: number;
};

/**
 * Headline counts for the stat tiles.
 *
 * There is no draft delta, and that is the server's shape, not an omission
 * here: nothing records when an entry moved *back* to draft, so a change figure
 * for drafts could only be invented.
 */
export type ContentTotals = {
    entries: number;
    published: number;
    drafts: number;
    entriesDelta: number;
    publishedDelta: number;
    entriesHistory: number[];
    publishedHistory: number[];
};

/** One age bucket of the staleness breakdown. */
export type StaleBucket = {
    /** `d30` · `d90` · `d180` · `d365` · `older`. */
    id: string;
    count: number;
};

/** Published entries grouped by how long ago they were last touched. */
export type ContentStale = {
    buckets: StaleBucket[];
    total: number;
};

/** Draft/published split for one content type. */
export type PipelineType = {
    name: string;
    label: string;
    published: number;
    drafts: number;
};

/** Draft/published split across the workspace's content types. */
export type ContentPipeline = {
    types: PipelineType[];
};

/** Live-vs-unpublished-edits split for one content type. */
export type UnshippedType = {
    name: string;
    label: string;
    /** Entries live with unpublished edits on top of what is live. */
    modified: number;
    /** Entries live and current. */
    published: number;
};

/**
 * Entries whose live version is behind what an editor has saved.
 *
 * `notLocalized`'s counterpart on the content side of the same idea: `status`
 * alone cannot separate a never-shipped draft from live content carrying
 * pending edits, which is why the server reads `publishedAt` too. `live` counts
 * only **publishable** types — an always-live singleton has nothing to ship, so
 * folding it into the denominator would make the share meaningless.
 */
export type ContentUnshipped = {
    /** One row per type holding at least one modified entry, biggest first. */
    types: UnshippedType[];
    modified: number;
    live: number;
    neverPublished: number;
};

/** Entries published per time bucket. */
export type ContentVelocity = {
    points: InsightsSeriesPoint[];
    granularity: 'day' | 'week' | 'month';
};

/** One weekday x hour cell of the editing punchcard. */
export type PunchcardCell = {
    /** ISO weekday, 1 = Monday ... 7 = Sunday. */
    weekday: number;
    /** Hour of day, 0-23, in UTC (the grouping is done database-side). */
    hour: number;
    count: number;
};

/**
 * Editing activity by weekday and hour. Only non-empty slots are sent — most of
 * a 7 x 24 grid is zero — so the client fills the gaps, and `max` rides along
 * because normalising from a sparse list would give the wrong denominator.
 */
export type ContentPunchcard = {
    cells: PunchcardCell[];
    max: number;
    total: number;
};

/**
 * The port over the content Insights endpoints.
 *
 * One method per widget, mirroring one endpoint per widget: the Insights page
 * mounts every card at once and each owns its own request, so a slow aggregate
 * degrades one card rather than blanking the dashboard.
 * {@link httpContentInsightsGateway} is the HTTP implementation.
 */
export type ContentInsightsGateway = {
    /** `GET /insights/content/totals` — counts, deltas and sparkline history. */
    totals(days: number): Promise<ContentTotals>;
    /** `GET /insights/content/stale` — published entries by last-edit age. */
    stale(): Promise<ContentStale>;
    /** `GET /insights/content/pipeline` — draft/published split per type. */
    pipeline(): Promise<ContentPipeline>;
    /** `GET /insights/content/unshipped` — live entries with pending edits. */
    unshipped(): Promise<ContentUnshipped>;
    /** `GET /insights/content/velocity` — entries published per bucket. */
    velocity(days: number): Promise<ContentVelocity>;
    /** `GET /insights/content/punchcard` — edits by weekday and hour. */
    punchcard(days: number): Promise<ContentPunchcard>;
};
