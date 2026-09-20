/**
 * The i18n plugin's pass over the host's OpenAPI document.
 *
 * Three read routes, all of them answering a hand-written `interface` that
 * `@nestjs/swagger` cannot see (`packages/bootstrap/server/AGENTS.md` → "The
 * response-schema gap"). This is the mechanism content-server already uses:
 * plain schema objects written onto the finished document, no decorator and no
 * runtime-referenceable class.
 *
 * Pure: it takes the document and the configured locale slugs, and touches only
 * the paths this plugin owns.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { buildI18nSchemas, ref, type OpenApiSchema } from './i18n-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** What one operation returns, and how to describe it. */
interface OperationSpec {
    /** Component name of the success schema. */
    schema: string;
    /** The success response's description. */
    description: string;
}

/**
 * The locales route, matched on its own full suffix.
 *
 * `/i18n/locales` and not a looser `/i18n` prefix: the insights plugin serves
 * `/api/insights/i18n/coverage`, which a pattern anchored on the bare segment
 * would also match. It would fall out of the route table below and describe
 * nothing — but only by luck, and the next route either plugin adds is where
 * luck runs out.
 */
const LOCALES_ROUTE_RE = /\/i18n\/locales$/;

/** Matches `<prefix>/i18n/content/{typeName}<rest>`. */
const CONTENT_ROUTE_RE = /\/i18n\/content\/\{typeName\}(.*)$/;

/** Content-scoped routes, keyed by what follows `/i18n/content/{typeName}`. */
const CONTENT_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '/{id}/locales': {
        get: {
            schema: 'I18nEntryLocalesView',
            description:
                'The entry’s translation group, one slot per configured locale.'
        }
    },
    '/locale-summary': {
        post: {
            schema: 'I18nLocaleSummaryView',
            description:
                'The requested groups and their live members. A read, so it answers 200 rather than a 201 claiming it created something.'
        }
    }
};

/** The locales route's one operation. */
const LOCALES_OPERATION: OperationSpec = {
    schema: 'I18nLocalesView',
    description: 'The configured locales, in display order.'
};

/**
 * Writes a success schema onto whichever 2xx key the scanner already emitted,
 * so this never invents a status code the API does not return. `POST
 * /locale-summary` carries `@HttpCode(200)`, which is why the key is read
 * rather than assumed.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { 'application/json': { schema } }
    };
    operation.responses = responses;
}

/** Adds a documented failure response, leaving any existing one alone. */
function addErrorResponse(
    operation: Operation,
    code: string,
    description: string
): void {
    const responses = operation.responses ?? {};
    if (responses[code]) {
        return;
    }
    responses[code] = { description };
    operation.responses = responses;
}

/** Applies one route table entry to a path item. */
function describeItem(
    item: Record<string, unknown>,
    byMethod: Record<string, OperationSpec>,
    contentScoped: boolean
): void {
    for (const [method, operation] of Object.entries(item)) {
        const spec = byMethod[method];
        if (!spec || !operation || typeof operation !== 'object') {
            continue;
        }
        const typed = operation as Operation;
        setSuccessResponse(typed, ref(spec.schema), spec.description);
        if (contentScoped) {
            // Both content routes resolve `:typeName` through the same
            // `resolveI18nType`, which draws exactly this line: a name nobody
            // registered is a missing resource, a registered type that is not
            // localized is a caller bug.
            addErrorResponse(
                typed,
                '400',
                'The content type exists but is not localized (`i18n: false`), so it has no translation groups.'
            );
            addErrorResponse(
                typed,
                '404',
                'Unknown content type — or, for the per-entry panel, no live entry with this id in the open workspace.'
            );
        }
    }
}

/**
 * Adds this plugin's schemas to `document` and attaches them to its own three
 * operations.
 */
export function describeI18nApi(
    document: OpenApiDocument,
    localeSlugs: readonly string[]
): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildI18nSchemas(localeSlugs));

    for (const [route, item] of Object.entries(document.paths)) {
        if (LOCALES_ROUTE_RE.test(route)) {
            describeItem(item, { get: LOCALES_OPERATION }, false);
            continue;
        }
        const match = CONTENT_ROUTE_RE.exec(route);
        const byMethod = match ? CONTENT_ROUTES[match[1]] : undefined;
        if (byMethod) {
            describeItem(item, byMethod, true);
        }
    }
}
