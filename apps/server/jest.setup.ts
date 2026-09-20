/**
 * Supplies the one deploy value `ortha.config.ts` refuses to default.
 *
 * The specs here assert the **real** composition — `ortha.config.ts` and
 * `buildPlugins`, not a mirror of them — which means they import a module that
 * now fails fast on a missing `DATABASE_URL`. That check is the point (a
 * deployment that boots without one dies several seconds later on an error that
 * names libpq rather than the variable), so the fix is to give the test run a
 * connection string, not to soften the check. Nothing connects: no spec in this
 * project opens a socket.
 *
 * Set only when absent, so a developer running the specs with a real `.env`
 * sourced keeps their own value.
 */
process.env['DATABASE_URL'] ??=
    'postgres://spec:spec@127.0.0.1:5432/ortha_cms_spec';
