import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@orthacms/identity-server';
import { renderGraphiQL } from '@graphql-yoga/render-graphiql';
import type { Request } from 'express';

/**
 * `GET /api/v1/graphql/playground` — GraphiQL, for exploring the API in a
 * browser. The GraphQL counterpart of the Scalar reference the host mounts at
 * `/reference`, and gated by the same switch.
 *
 * **Registered only when the host enables it.** `ContentGraphqlModule.forRoot`
 * leaves this controller out entirely when `playground` is false, so a
 * production deployment does not serve a 403 or a 404 from a live handler — the
 * route does not exist. The host wires it to `docs.enabled`, which is off in
 * production unless `API_DOCS=true`.
 *
 * **Deliberately unauthenticated**, unlike every other route in this package.
 * The API it drives takes a bearer token, and you cannot paste a token into a
 * page you are not allowed to load — so requiring one here would be a
 * chicken-and-egg. The page itself carries no content and reads nothing: it is
 * a static asset that happens to be generated. The credential is supplied by
 * whoever opens it, in GraphiQL's own header editor, and is never stored
 * server-side.
 *
 * That combination — a public page inviting a pasted credential — is exactly
 * why it is dev-gated rather than always on.
 */
@Public()
@Controller('v1/graphql')
export class GraphqlPlaygroundController {
    /**
     * The rendered page, built once.
     *
     * `renderGraphiQL` inlines the whole GraphiQL bundle, so the result is ~9 MB
     * of self-contained HTML — no CDN, which is what makes this work in an
     * air-gapped install. Rendering it per request would burn that on every
     * reload for a byte-identical result, so it is memoised.
     *
     * **One slot, not a map.** A deployment has exactly one endpoint, but the
     * key is derived from the request URL and Express matches a route
     * case-insensitively, so `/api/v1/GraphQL/playground` and its two thousand
     * siblings are all 200s deriving a distinct key. Memoising per key retained
     * ~17 MB of heap for each one and never released it: measured, sixteen
     * spellings of `graphql` grew RSS by 269 MB, on a route that is deliberately
     * unauthenticated. One slot bounds the page at its own size, and the only
     * cost of a hostile spelling is re-rendering the page it asked for.
     */
    private rendered?: { endpoint: string; html: string };

    /** `GET /api/v1/graphql/playground` — the GraphiQL page. */
    @Get('playground')
    @Header('Content-Type', 'text/html; charset=utf-8')
    // Excluded from the OpenAPI document: it is a browser page, not part of the
    // API contract, and its 9 MB HTML response is not a schema worth describing.
    @ApiExcludeEndpoint()
    playground(@Req() request: Request): string {
        const endpoint = endpointFor(request);
        if (this.rendered?.endpoint !== endpoint) {
            this.rendered = {
                endpoint,
                html: renderGraphiQL({
                    endpoint,
                    title: 'Ortha CMS — content API',
                    defaultQuery: DEFAULT_QUERY
                })
            };
        }
        return this.rendered.html;
    }
}

/**
 * The API endpoint this page should post to, derived from the URL the page was
 * served on by dropping the trailing `/playground`.
 *
 * Derived rather than configured because the plugin does not know the host's
 * global prefix — `createServer` owns that, and a deployment may change it. The
 * page and the endpoint are siblings by construction, so the request's own path
 * is the one source that cannot be wrong.
 *
 * A trailing slash is dropped first: Express serves `…/playground/` from the
 * same route, and without this it fell through to the hard-coded default and
 * quietly handed the page a wrong endpoint on any host with a non-default
 * global prefix.
 */
function endpointFor(request: Request): string {
    const url = (request.originalUrl || request.url || '')
        .split('?')[0]
        .replace(/\/+$/, '');
    return url.endsWith('/playground')
        ? url.slice(0, -'/playground'.length)
        : '/api/v1/graphql';
}

/**
 * What the editor opens with. Names the two things a first-time caller
 * otherwise has to discover: the endpoint needs an `Authorization` header, and
 * the schema they see is scoped to their workspace's content grants.
 */
const DEFAULT_QUERY = `# Ortha CMS content API
#
# 1. Add your bearer token in the "Headers" tab below:
#      { "Authorization": "Bearer orthacms_…" }
#    Mint one in the admin under API Tokens.
#
# 2. If the token covers more than one workspace, also send:
#      { "X-Workspace-Id": "…" }
#
# The schema shown here is built from that workspace's content grants, so two
# tokens can legitimately see different types.

{
  contentTypes {
    name
    label
    kind
    publishable
    i18n
  }
}
`;
