/**
 * Environment for the server unit tests.
 *
 * They build the plugin list, which imports `ortha.config.ts` — and that file
 * deliberately refuses to load without `DATABASE_URL`, because a blank
 * connection string reaches `pg` as "use the libpq defaults" and migrations
 * then run against whatever database the local environment happens to name.
 *
 * Nothing here connects to anything: the plugin list is a pure function of the
 * config. So load a real `.env` when there is one, and fall back to
 * placeholders — which is what lets `npm test` run in CI with no `.env` at all.
 */
const { existsSync } = require('node:fs');

if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile('.env');
}

process.env.DATABASE_URL ||=
    'postgresql://ortha:ortha@localhost:5432/placeholder';
