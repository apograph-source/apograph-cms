import { Logger } from '@nestjs/common';
import { loadDotEnv, resolveTestDatabaseUrl } from './support/db';

/**
 * Points this worker at the e2e database **before any module loads**.
 *
 * `ortha.config.ts` reads `process.env` at import time, so this has to be a
 * `setupFiles` entry — those run before the module registry is touched, unlike
 * `setupFilesAfterEnv`. Jest loads no `.env` of its own in a worker either,
 * hence `loadDotEnv` first.
 *
 * Nothing is handed over from `global-setup`: the URL is derived by the same
 * pure function in both places, so there is no channel to get out of step.
 */
loadDotEnv();

process.env['DATABASE_URL'] = resolveTestDatabaseUrl();

// A root admin is provisioned on boot when these are set, which is what gives
// the suite a real account to sign in with.
process.env['ORTHA_ROOT_ADMIN_EMAIL'] ||= 'e2e@example.com';
process.env['ORTHA_ROOT_ADMIN_PASSWORD'] ||= 'e2e-password-not-a-secret';

// `createServer` builds its own Nest app and takes no logger option, so this
// is the only way to keep a full boot banner — every mapped route, every
// seeder — out of the output for each suite that boots one. A failing
// assertion is then the first thing on screen instead of the last.
Logger.overrideLogger(false);
