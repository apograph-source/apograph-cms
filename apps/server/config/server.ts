/**
 * Host-level settings that belong to no plugin — how the app sits behind a
 * proxy, and how large a request body it will parse.
 */
import type { TrustProxySetting } from '@orthacms/bootstrap-server';

import { readEnv, readTrustProxy } from '@orthacms/utils-server';

/**
 * `TRUST_PROXY` as Express's `trust proxy` setting.
 *
 * Unset by default: a directly-exposed server must not believe a
 * client-supplied `X-Forwarded-For`. Deployments behind a load balancer set it
 * to their hop count — the only shape a client cannot forge past.
 *
 * The shared reader returns the union structurally (`boolean | number | string`)
 * rather than importing `TrustProxySetting`, so that a leaf helper package does
 * not depend on the host. This is where the two are checked against each other:
 * narrow `TrustProxySetting` and this line stops compiling.
 */
export function trustProxy(): TrustProxySetting | undefined {
    return readTrustProxy();
}

/**
 * The largest JSON / urlencoded body a route will accept.
 *
 * Stable tuning, hence a literal, with an env override for a deployment whose
 * entries are larger. 1 MB rather than express's inherited 100 kB default: that
 * ceiling sat below a long-form article with embedded rich text, and it was
 * refused with a bare `413` from the parser — before any controller, guard or
 * protocol layer could shape the answer. Uploads are unrelated and much larger;
 * they are multipart, capped by `plugins.media.maxUploadBytes`.
 */
export function bodyLimit(): string | number {
    return readEnv('MAX_REQUEST_BODY') ?? '1mb';
}
