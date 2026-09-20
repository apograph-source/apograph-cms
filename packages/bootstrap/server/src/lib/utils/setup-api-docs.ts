import { Logger, type INestApplication } from '@nestjs/common';
import {
    DocumentBuilder,
    SwaggerModule,
    type OpenAPIObject
} from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { ApiDocsOptions } from '../types/api-docs';
import type { OpenApiDocument } from '../types/plugin-api-docs';
import type { ServerPlugin } from '../types/server-plugin';

/** The `addSecurity` payload type, without deep-importing `@nestjs/swagger`. */
type SecurityScheme = Parameters<DocumentBuilder['addSecurity']>[1];

/** A request handler the http adapter accepts, whatever its flavour. */
type Handler = (req: unknown, res: unknown) => unknown;

/** The one response capability the JSON route needs. */
interface JsonResponse {
    json(body: unknown): unknown;
}

/**
 * The path-item keys that are operations.
 *
 * A path item may also carry `parameters`, `$ref`, `summary`, `description`
 * and `servers` — none of which take a `tags` property. Iterating
 * `Object.values(item)` and writing `.tags` onto everything object-shaped
 * would put one on a path-level `parameters` **array**, producing a document
 * that no longer validates. Nest emits no such key today, which is exactly why
 * a fixed allow-list is cheaper than discovering the day it does.
 */
const OPERATION_KEYS = [
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace'
] as const;

const DEFAULT_PATH = '/reference';
const DEFAULT_JSON_PATH = '/reference/json';
const DEFAULT_TITLE = 'Ortha CMS API';
const DEFAULT_VERSION = '1.0.0';

/** Ensures a mount path has exactly one leading slash. */
function normalizePath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Groups every operation under its **resource** — the first route segment after
 * the global prefix (`/api/content/post` → `content`).
 *
 * The alternative, `autoTagControllers`, tags by controller class name; this
 * codebase deliberately runs one controller per use case, so that yields ~50
 * one-operation groups. Grouping by resource gives the reference a sidebar that
 * matches how the API is actually laid out.
 */
function tagByResource(document: OpenAPIObject, globalPrefix: string): void {
    const prefix = globalPrefix.replace(/^\/|\/$/g, '');
    const tags = new Set<string>();

    for (const [route, item] of Object.entries(document.paths)) {
        const segments = route.split('/').filter(Boolean);
        const resource = segments[0] === prefix ? segments[1] : segments[0];
        if (!resource) {
            continue;
        }
        tags.add(resource);
        const pathItem = item as Record<string, unknown>;
        for (const method of OPERATION_KEYS) {
            const operation = pathItem[method];
            if (operation && typeof operation === 'object') {
                (operation as { tags?: string[] }).tags = [resource];
            }
        }
    }

    Object.assign(document, {
        tags: [...tags].sort().map((name) => ({ name }))
    });
}

/**
 * Builds the OpenAPI document for the running app and mounts the Scalar API
 * reference on it.
 *
 * The document is generated from the plugin-contributed controllers and their
 * DTOs — the `@ApiProperty` metadata each DTO carries is what makes the schemas
 * useful — and plugins describe their own auth through
 * {@link ServerPlugin.docs}. Both routes are registered on the http adapter
 * rather than the Nest router, so they sit **outside** the global `api` prefix
 * and outside every guard.
 *
 * Returns the mounted paths, or `null` when docs are disabled.
 */
export function setupApiDocs(
    app: INestApplication,
    plugins: ServerPlugin[],
    options: ApiDocsOptions = {},
    globalPrefix = 'api'
): { path: string; jsonPath: string } | null {
    const {
        enabled = process.env['NODE_ENV'] !== 'production',
        path = DEFAULT_PATH,
        jsonPath = DEFAULT_JSON_PATH,
        title = DEFAULT_TITLE,
        description,
        version = DEFAULT_VERSION,
        cdn
    } = options;

    if (!enabled) {
        return null;
    }

    const builder = new DocumentBuilder().setTitle(title).setVersion(version);

    if (description) {
        builder.setDescription(description);
    }

    for (const plugin of plugins) {
        for (const [name, scheme] of Object.entries(
            plugin.docs?.securitySchemes ?? {}
        )) {
            builder.addSecurity(name, scheme as SecurityScheme);
        }
        for (const name of plugin.docs?.defaultSecurity ?? []) {
            builder.addSecurityRequirements(name);
        }
    }

    // `createDocument` keeps the global prefix in the paths, so the document
    // describes the URLs a client actually calls (`/api/...`).
    const document = SwaggerModule.createDocument(app, builder.build(), {
        autoTagControllers: false
    });
    tagByResource(document, globalPrefix);

    // Last: each plugin's own pass, so a plugin that describes itself (content
    // types are runtime data, invisible to the scanner) sees a finished,
    // already-tagged document.
    //
    // Guarded per plugin: the reference is developer tooling, and a plugin
    // whose docs pass throws should cost its own contribution to the document,
    // not the entire API. Unguarded, one bad `decorate` aborted `createServer`
    // itself and the server never listened.
    for (const plugin of plugins) {
        try {
            plugin.docs?.decorate?.(document as unknown as OpenApiDocument);
        } catch (error) {
            Logger.error(
                `Plugin "${plugin.name}" threw while decorating the OpenAPI document; its contribution is omitted from the reference.`,
                error instanceof Error
                    ? (error.stack ?? error.message)
                    : String(error)
            );
        }
    }

    const uiPath = normalizePath(path);
    const documentPath = normalizePath(jsonPath);
    const httpAdapter = app.getHttpAdapter();

    // The JSON route is registered first: it must win over the UI mount for
    // the (default) case where it lives underneath it.
    const sendDocument: Handler = (_req, res) =>
        (res as JsonResponse).json(document);
    httpAdapter.get(documentPath, sendDocument);

    httpAdapter.get(
        uiPath,
        apiReference({
            content: document,
            pageTitle: title,
            ...(cdn ? { cdn } : {})
        }) as Handler
    );

    Logger.log(`📘 API reference: ${uiPath} (OpenAPI JSON: ${documentPath})`);

    return { path: uiPath, jsonPath: documentPath };
}
