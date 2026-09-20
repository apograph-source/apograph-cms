import { Logger } from '@nestjs/common';
import { createServer } from '@orthacms/bootstrap-server';
import config from '../ortha.config';
import { buildPlugins } from './plugins';

createServer({
    plugins: buildPlugins(config),
    port: config.port,
    globalPrefix: config.globalPrefix,
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimit,
    docs: config.docs
}).catch((error: unknown) => {
    // Without this the promise is simply dropped: a plugin that fails to
    // initialize, an invalid `TRUST_PROXY`, or a port already in use all
    // surfaced as a raw unhandled-rejection dump from Node with no line saying
    // the server failed to start. `createServer` names the failing plugin or
    // phase; this is what turns the rejection into a logged fatal and a
    // deliberate non-zero exit.
    Logger.error(
        'The server failed to start.',
        error instanceof Error ? (error.stack ?? error.message) : String(error)
    );
    process.exit(1);
});
