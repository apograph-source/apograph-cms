/**
 * This app's reading of the environment.
 *
 * The readers themselves are not here — they live in `@orthacms/utils-server`,
 * shared with the scaffolder's template so a generated app validates its
 * environment exactly as this one does. Builders in this folder import them
 * directly, so this file is not a barrel in front of them; what is left here is
 * the one derivation this host makes on top of them.
 */

import { isProduction as readIsProduction } from '@orthacms/utils-server';

/**
 * True only in a deployment that said so, with the spelling checked.
 *
 * A **constant**, evaluated once at import, where the shared helper is a
 * function. Two reasons. It gates two protections — whether the API reference
 * is published, and whether the session cookie carries `Secure` — and reading
 * it twice invites the two to disagree if something mutates `process.env`
 * mid-boot. And the refusal it can throw belongs at import, alongside the other
 * validation this config does, rather than at whichever builder happens to ask
 * first.
 */
export const isProduction = readIsProduction();
