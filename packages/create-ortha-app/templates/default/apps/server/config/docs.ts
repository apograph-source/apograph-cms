/** The OpenAPI document and the API reference it is served as. */
import type { ApiDocsOptions } from '@orthacms/bootstrap-server';
import { isProduction, readFlag } from '@orthacms/utils-server';

/** The OpenAPI document and the API reference it is served as. */
export function docsConfig(): ApiDocsOptions {
    return {
        // On outside production, where the reference is a development tool.
        // `API_DOCS=true` publishes it from a deployed instance.
        enabled: readFlag('API_DOCS', !isProduction()),
        title: '__APP_TITLE__ API',
        version: '1.0.0'
    };
}
