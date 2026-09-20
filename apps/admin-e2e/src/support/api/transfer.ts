import { type Page } from '@playwright/test';

/**
 * The seed layer for `@orthacms/transfer-admin` — the export and import dialogs
 * the Content Library hangs off its three slots.
 *
 * Four routes, all of them **under** `/api/content/:type/`:
 *
 * | Route                                 | Who reads it            |
 * | ------------------------------------- | ----------------------- |
 * | `POST …/export/preview`               | the export dialog's live counts |
 * | `POST …/export`                       | the download itself     |
 * | `POST …/import/preview`               | "Check the file"        |
 * | `POST …/import`                       | "Import"                |
 *
 * **Register these after the `content` mocks.** Playwright matches handlers in
 * reverse registration order, and `mockContentEntryWrites`'s
 * `/api/content/:name/:id` regex matches `/api/content/blog_post/import` — so a
 * transfer mock registered first would never be reached and the import would be
 * answered as if it were an entry write.
 *
 * The responses are **functions of the request**, not fixed bodies: the export
 * preflight is the one thing that makes the depth toggles honest (turning
 * "related records" off has to change the counts), and an import's verdicts
 * depend on the two policies. A fixed body would let a dialog that never sends
 * the settings pass every assertion.
 */

/** The `depth` object both export routes take. */
export interface TransferDepthSeed {
    relations: boolean;
    media: boolean;
    locales: boolean;
    relationLocales: boolean;
}

/** One export request, as the dialog sent it. */
export interface ExportRequestSeen {
    ids: string[];
    format: string;
    depth: TransferDepthSeed;
}

/** What `POST /export/preview` answers — the numbers under the toggles. */
export interface ExportPreviewSeed {
    roots: number;
    related: number;
    assets: number;
    assetBytes: number;
    /** Whether the chosen format will carry those bytes (the server's word). */
    carriesFileBytes: boolean;
}

/** What the export dialog asked for, in order. */
export interface TransferExportSpy {
    readonly previews: readonly ExportRequestSeen[];
    readonly downloads: readonly ExportRequestSeen[];
}

interface ExportOptions {
    /**
     * The counts for a given request. The default derives them from the depth,
     * so a toggle that never reaches the wire shows up as an unchanged line.
     */
    counts?: (request: ExportRequestSeen) => ExportPreviewSeed;
    /** Status for the **preflight**; a `4xx` fails fast (no retry ladder). */
    previewStatus?: number;
}

/** The default preflight: numbers that move with the depth that was asked for. */
function defaultCounts(request: ExportRequestSeen): ExportPreviewSeed {
    const { ids, format, depth } = request;
    return {
        roots: ids.length,
        related: depth.relations ? 4 : 0,
        assets: depth.media ? 2 : 0,
        assetBytes: depth.media ? 2048 : 0,
        // The server's own capability table, mirrored: only a ZIP carries bytes.
        carriesFileBytes: format === 'zip' && depth.media
    };
}

/** Reads the JSON body of an export request into the shape the spy records. */
function exportRequest(body: unknown): ExportRequestSeen {
    const parsed = (body ?? {}) as Partial<ExportRequestSeen>;
    return {
        ids: parsed.ids ?? [],
        format: parsed.format ?? '',
        depth: (parsed.depth ?? {
            relations: false,
            media: false,
            locales: false,
            relationLocales: false
        }) as TransferDepthSeed
    };
}

/**
 * Stub the two **export** routes and record what the dialog sent.
 *
 * The download answers with a tiny body plus the two headers the client reads
 * (`Content-Disposition` for the filename, `X-Transfer-Records` for the toast's
 * count), so a spec that presses Export exercises the real blob path.
 */
export async function mockTransferExport(
    page: Page,
    { counts = defaultCounts, previewStatus = 200 }: ExportOptions = {}
): Promise<TransferExportSpy> {
    const previews: ExportRequestSeen[] = [];
    const downloads: ExportRequestSeen[] = [];

    await page.route('**/api/content/*/export', async (route) => {
        const request = exportRequest(route.request().postDataJSON?.());
        downloads.push(request);
        await route.fulfill({
            status: 200,
            contentType: 'application/octet-stream',
            headers: {
                'content-disposition': `attachment; filename="${
                    request.format === 'csv' ? 'blog_post.csv' : 'export.zip'
                }"`,
                'x-transfer-records': String(request.ids.length)
            },
            body: 'transfer-e2e'
        });
    });

    await page.route('**/api/content/*/export/preview', async (route) => {
        const request = exportRequest(route.request().postDataJSON?.());
        previews.push(request);
        if (previewStatus >= 400) {
            await route.fulfill({
                status: previewStatus,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Could not count that.' })
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(counts(request))
        });
    });

    return {
        get previews() {
            return previews;
        },
        get downloads() {
            return downloads;
        }
    };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/** One record's verdict, as the dry run and the apply both report it. */
export interface ImportVerdictSeed {
    $type: string;
    $id: string;
    label: string;
    action: 'create' | 'update' | 'skip' | 'error';
    reason: string;
    locale?: string;
    targetId?: string;
    unresolved?: string[];
    issues?: string[];
}

/** The run's totals, above the verdict table. */
export interface ImportCountsSeed {
    create: number;
    update: number;
    skip: number;
    error: number;
    assetsNew: number;
    assetsReused: number;
}

/** The dry run's whole answer. */
export interface ImportPreviewSeed {
    version: number;
    counts: ImportCountsSeed;
    verdicts: ImportVerdictSeed[];
    /** Whether anything would change — what gates the Import button. */
    hasChanges: boolean;
}

/** What an import request carried, read back out of the multipart body. */
export interface ImportRequestSeen {
    filename: string;
    policy: string;
    relations: string;
}

/** What the import dialog asked for, in order. */
export interface TransferImportSpy {
    readonly previews: readonly ImportRequestSeen[];
    readonly applies: readonly ImportRequestSeen[];
}

/** Totals with everything at zero, to spread over. */
export function importCounts(
    overrides: Partial<ImportCountsSeed> = {}
): ImportCountsSeed {
    return {
        create: 0,
        update: 0,
        skip: 0,
        error: 0,
        assetsNew: 0,
        assetsReused: 0,
        ...overrides
    };
}

/**
 * A run that would add one record and update another — the ordinary case, and
 * the one the "the table went stale" assertions are written against: it has to
 * be a table a reader would act on, or its disappearance proves nothing.
 */
export const IMPORT_RUN: ImportPreviewSeed = {
    version: 1,
    counts: importCounts({ create: 1, update: 1 }),
    verdicts: [
        {
            $type: 'blog_post',
            $id: 'src-1',
            label: 'Imported story',
            action: 'create',
            reason: 'new'
        },
        {
            $type: 'blog_post',
            $id: 'src-2',
            label: 'Hello world',
            action: 'update',
            reason: 'matched',
            targetId: 'post-1'
        }
    ],
    hasChanges: true
};

/** A run of nothing but skips — the "Import" button has nothing to offer. */
export const IMPORT_NOTHING_TO_DO: ImportPreviewSeed = {
    version: 1,
    counts: importCounts({ skip: 2 }),
    verdicts: [
        {
            $type: 'blog_post',
            $id: 'src-1',
            label: 'Hello world',
            action: 'skip',
            reason: 'conflict-skipped'
        },
        {
            $type: 'blog_post',
            $id: 'src-2',
            label: 'Second story',
            action: 'skip',
            reason: 'conflict-skipped'
        }
    ],
    hasChanges: false
};

/** One field out of a multipart body — the settings ride beside the file. */
function multipartField(body: string, name: string): string {
    const match = new RegExp(
        `name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`
    ).exec(body);
    return match?.[1] ?? '';
}

/** The uploaded part's filename, so a spec can tell one file from another. */
function multipartFilename(body: string): string {
    return /name="file"; filename="([^"]*)"/.exec(body)?.[1] ?? '';
}

interface ImportOptions {
    /** The dry run's answer for a given request. */
    preview?: (request: ImportRequestSeen) => ImportPreviewSeed;
    /**
     * What the apply reports. Called **once per apply**, so a spec can use it as
     * the moment the server-side row set changed — pushing a row into the seed
     * the entries mock serves is how "the list was re-read" becomes visible.
     */
    apply?: (request: ImportRequestSeen) => {
        counts: ImportCountsSeed;
        verdicts: ImportVerdictSeed[];
    };
    /** Status for the apply; a `4xx` fails fast and surfaces the server message. */
    applyStatus?: number;
    /** The message a failed apply answers with — the dialog shows it verbatim. */
    applyMessage?: string;
}

/**
 * Stub the two **import** routes and record what the dialog sent.
 *
 * Both are `multipart/form-data`, so the request is read back out of the raw
 * body rather than as JSON: the two policies travel as form fields beside the
 * file, and a dialog that dropped one would still upload a file happily.
 */
export async function mockTransferImport(
    page: Page,
    {
        preview = () => IMPORT_RUN,
        apply = (request) => {
            const run = preview(request);
            return { counts: run.counts, verdicts: run.verdicts };
        },
        applyStatus = 200,
        applyMessage = 'That file could not be imported.'
    }: ImportOptions = {}
): Promise<TransferImportSpy> {
    const previews: ImportRequestSeen[] = [];
    const applies: ImportRequestSeen[] = [];

    const seen = (route: {
        request: () => { postData: () => string | null };
    }): ImportRequestSeen => {
        const body = route.request().postData() ?? '';
        return {
            filename: multipartFilename(body),
            policy: multipartField(body, 'policy'),
            relations: multipartField(body, 'relations')
        };
    };

    // The bare `…/import` first, the more specific `…/import/preview` after
    // it — the last handler registered is the one Playwright tries first. A
    // glob `*` does not cross a `/`, so `…/*/import` cannot swallow the preview
    // on its own; the order is what keeps that true if either pattern ever
    // gains a trailing wildcard.
    await page.route('**/api/content/*/import', async (route) => {
        const request = seen(route);
        applies.push(request);
        if (applyStatus >= 400) {
            await route.fulfill({
                status: applyStatus,
                contentType: 'application/json',
                body: JSON.stringify({ message: applyMessage })
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(apply(request))
        });
    });

    await page.route('**/api/content/*/import/preview', async (route) => {
        const request = seen(route);
        previews.push(request);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(preview(request))
        });
    });

    return {
        get previews() {
            return previews;
        },
        get applies() {
            return applies;
        }
    };
}
