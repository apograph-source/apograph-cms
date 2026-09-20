import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ServerModule } from './server.module';
import type { CreateServerOptions } from './types/server-plugin';
import { serveAdmin } from './utils/serve-admin';
import { setupApiDocs } from './utils/setup-api-docs';

/**
 * Default cap on a JSON / urlencoded request body.
 *
 * Written out because the alternative is inheriting `express.json()`'s 100 kB,
 * which nobody chose and which a long-form article with embedded rich text
 * reaches — the parser answers `413` before any controller sees the request, so
 * the ceiling on "how large a piece of content this CMS accepts" was an
 * accident of a dependency's default. 1 MB clears every realistic entry body
 * while still bounding what an unauthenticated caller can make the parser
 * allocate. Uploads are unaffected: they are multipart, bounded separately by
 * the media plugin's `maxUploadBytes`.
 */
const DEFAULT_BODY_LIMIT = '1mb';

/** Renders a thrown value for a log line, without assuming it is an `Error`. */
function describeError(error: unknown): string {
    return error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
}

/**
 * Bootstraps the Ortha CMS server: runs each plugin's `onPluginInit`
 * hook in order, imports every plugin's NestJS module, applies the proxy
 * trust setting, sets the global prefix, the body-size cap and a strict
 * validation pipe, generates the OpenAPI document and mounts the Scalar API
 * reference, enables shutdown hooks, then listens.
 *
 * Returns the listening application. `main.ts` ignores it — the process *is*
 * the lifetime there — but a host that embeds the server (a test, a script
 * that boots one app per scenario) has no other way to shut the thing down
 * again, and a bootstrap nobody can close is a bootstrap nobody can test.
 */
export async function createServer(
    options: CreateServerOptions
): Promise<NestExpressApplication> {
    const {
        plugins,
        port = 3000,
        host,
        globalPrefix = 'api',
        trustProxy,
        bodyLimit = DEFAULT_BODY_LIMIT,
        docs,
        staticDir
    } = options;

    // Run plugin setup hooks in order, before the app is created — so a
    // plugin can open resources (e.g. a db connection) that its module's
    // providers depend on at instantiation time.
    //
    // Wrapped so the failure names the plugin. Unwrapped, a throwing hook
    // reaches the caller as a bare stack trace with nothing in it identifying
    // which of a dozen registered plugins refused to start.
    for (const plugin of plugins) {
        try {
            await plugin.onPluginInit?.();
        } catch (error) {
            Logger.error(
                `Plugin "${plugin.name}" failed in onPluginInit; the server cannot start.`,
                describeError(error)
            );
            throw error;
        }
    }

    const app = await NestFactory.create<NestExpressApplication>(
        ServerModule.forRoot(plugins)
    );

    // Before anything reads `req.ip`. A plugin that rate-limits or audits by
    // client address (identity's login throttle, its session rows) is only as
    // correct as this setting, and Express ignores `X-Forwarded-For` until it
    // is made — so behind a proxy every caller would otherwise share one
    // address, and one bucket.
    if (trustProxy !== undefined) {
        app.set('trust proxy', trustProxy);
    }

    // Re-register the body parsers with an explicit cap, replacing the ones
    // Nest installs with express's defaults. See {@link DEFAULT_BODY_LIMIT}.
    app.useBodyParser('json', { limit: bodyLimit });
    app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

    app.setGlobalPrefix(globalPrefix);
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true
        })
    );

    // After the prefix + pipe, so the document describes the real URLs; before
    // `listen`, so the reference is reachable the moment the port opens.
    setupApiDocs(app, plugins, docs, globalPrefix);

    // Last, so every controller route and the reference are already registered
    // and the SPA fallback can only ever see what none of them claimed.
    if (staticDir) {
        serveAdmin(app, staticDir, globalPrefix);
    }

    // SIGTERM is how every orchestrator ends a pod, and without this Node's
    // default handler tears the process down where it stands — every in-flight
    // request dies mid-response, which on a rolling deploy is one dropped
    // request per connection per replica. With it, Nest closes the HTTP server,
    // lets the requests already accepted finish, runs each module's
    // `onModuleDestroy`, and only then re-raises the signal.
    app.enableShutdownHooks();

    try {
        // `host` omitted keeps Node's wildcard bind, which is what a container
        // wants; naming one binds a single interface (see `CreateServerOptions`).
        await (host ? app.listen(port, host) : app.listen(port));
    } catch (error) {
        Logger.error(
            `Failed to listen on port ${port}${host ? ` (${host})` : ''}; the server cannot start.`,
            describeError(error)
        );
        throw error;
    }
    Logger.log(
        `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
    );

    return app;
}
