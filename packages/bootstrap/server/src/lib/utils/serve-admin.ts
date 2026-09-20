import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The slice of express's request/response this file touches.
 *
 * Declared structurally rather than imported from `express`, which this
 * package does not depend on directly — it reaches express only through
 * `@nestjs/platform-express`. Importing the types anyway would make it a
 * phantom dependency: resolvable here (npm hoists it into the workspace root)
 * and absent from a consumer's tree, which is exactly what `pack.mjs`'s
 * `verifyDependenciesAreDeclared` refuses to publish.
 */
interface StaticRequest {
    method: string;
    path: string;
    accepts(type: string): string | false;
}

interface StaticResponse {
    sendFile(path: string): void;
}

/**
 * Path prefixes the SPA fallback must never answer.
 *
 * The fallback exists to turn a deep link (`/workspaces/1/entries/2`) into
 * `index.html` so the router can pick it up on a hard refresh. Applied to
 * everything, it also swallows **404s from the API** — a mistyped or removed
 * endpoint would stop returning a JSON `404` and start returning `200` with a
 * page of HTML, which is the single most confusing failure this feature can
 * produce: every client sees a successful response and a JSON parse error, and
 * nothing in it says the route does not exist.
 *
 * The API's own prefix is added at call time (it is configurable); these are
 * the fixed ones the host mounts irrespective of it.
 */
const NEVER_FALLBACK = ['/reference'];

/** True when `path` belongs to something other than the SPA. */
function isReservedPath(path: string, reserved: readonly string[]): boolean {
    return reserved.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );
}

/**
 * Serves a built admin bundle from `staticDir`, with an SPA fallback for
 * client-side routes.
 *
 * Mounted **after** the API: Nest's router already holds every controller
 * route by the time this runs, so a request that matches one never reaches
 * here. What arrives is either a real asset, a client-side route, or a 404.
 *
 * A missing or unbuilt directory is a warning rather than a throw. The server
 * is fully functional without a UI, and failing boot here would mean a
 * deployment that forgot `ortha build` loses its API too — with a stack trace
 * that says nothing about the admin bundle.
 */
export function serveAdmin(
    app: NestExpressApplication,
    staticDir: string,
    globalPrefix: string
): void {
    const root = resolve(staticDir);
    const index = join(root, 'index.html');

    if (!existsSync(index)) {
        Logger.warn(
            `No admin bundle at ${root} (no index.html) — serving the API only. ` +
                `Run the admin build before starting the server to serve the UI from here.`,
            'ServeAdmin'
        );
        return;
    }

    // `index: false` so the static handler does not answer `/` itself: the
    // fallback below owns every HTML response, which keeps "what does a
    // navigation return" in one place rather than split across two handlers.
    app.useStaticAssets(root, { index: false });

    const reserved = [
        `/${globalPrefix.replace(/^\/+|\/+$/g, '')}`,
        ...NEVER_FALLBACK
    ];

    app.use(
        (
            request: StaticRequest,
            response: StaticResponse,
            next: () => void
        ) => {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return next();
            }
            if (isReservedPath(request.path, reserved)) return next();

            // A path with a file extension is an asset request, and a missing
            // asset must keep 404ing. Answered with `index.html` instead, the
            // browser reports a MIME-type error rather than the missing file — so
            // a stale `index.html` still referencing a deleted hashed chunk reads
            // as a bundler bug instead of the bad deploy it is.
            //
            // The extension test is what does the work here, **not** the `Accept`
            // header below. A browser requests scripts and stylesheets with
            // `Accept: */*`, and so does every default HTTP client; `accepts('html')`
            // answers `'html'` to `*/*`, so on its own it lets exactly the requests
            // this is meant to exclude straight through. (Measured against a real
            // build: `GET /assets/deleted-chunk.js` returned 200 and the page.)
            if (extname(request.path)) return next();

            // Kept as a secondary filter for the caller that *is* explicit — an
            // API client sending `Accept: application/json` gets a 404 it can
            // parse, rather than a page it cannot.
            if (!request.accepts('html')) return next();

            return response.sendFile(index);
        }
    );

    Logger.log(`Serving the admin bundle from ${root}`, 'ServeAdmin');
}
