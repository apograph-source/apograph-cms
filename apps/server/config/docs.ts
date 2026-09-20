/** The OpenAPI document and the Scalar API reference it is served as. */
import type { ApiDocsOptions } from '@orthacms/bootstrap-server';

import { readFlag } from '@orthacms/utils-server';

import { isProduction } from './env';

/** OpenAPI document + Scalar API reference settings. */
export function docsConfig(): ApiDocsOptions {
    return {
        // On outside production, where the reference is a development tool.
        // `API_DOCS` overrides either way — set it to `true` to publish the
        // reference from a deployed instance.
        enabled: readFlag('API_DOCS', !isProduction),
        title: 'Ortha CMS API',
        version: '1.0.0',
        description: [
            'The Ortha CMS HTTP API, assembled from the plugins registered in',
            '`apps/server/src/plugins.ts`. Every route lives under the `/api`',
            'prefix and is authenticated by default — a browser session cookie',
            'from `POST /api/auth/login`, or a bearer API token for the',
            'external content API.',
            '',
            'Workspace-scoped routes (content, media, workspace members) also',
            'require an `X-Workspace-Id` header naming a workspace the caller',
            'is a member of.'
        ].join('\n')
    };
}
