# Renaming OrthaCms to Apograph

The project is called **Apograph**. An _apograph_ is a copy made from a
canonical original — which is what this CMS does with content: one authored
record, handed out as copies over REST, GraphQL and MCP.

This note is for someone **upgrading an existing installation**. A fresh install
needs nothing from here.

## What changed

| Before                | After                 |
| --------------------- | --------------------- |
| `@orthacms/*`         | `@apograph/*`         |
| `create-ortha-app`    | `create-apograph-app` |
| `ortha` (CLI)         | `apograph`            |
| `ortha.config.ts`     | `apograph.config.ts`  |
| `ORTHA_*` (env)       | `APOGRAPH_*`          |
| `X-Ortha-*` (headers) | `X-Apograph-*`        |
| `ortha://` (MCP URIs) | `apograph://`         |

No table, column, index or migration was renamed. **The database is untouched**,
and no migration is needed for the rename itself.

## What keeps working, and for how long

Two surfaces reach outside this repository, so both accept the old spelling for
one major version. Each warns rather than failing quietly.

### Environment variables

Every `APOGRAPH_*` read falls back to the `ORTHA_*` name, and warns once per
variable naming both spellings. An existing `.env` boots unchanged.

The new name wins when both are set, so a half-migrated `.env` cannot have the
stale value take precedence.

### Webhook headers

Every delivery carries **both** header sets — `X-Apograph-*` and `X-Ortha-*` —
with identical values, signature included. A receiver written against either
name keeps verifying.

This matters more than the env fallback: renaming the prefix in place would have
every existing receiver start rejecting deliveries the moment it shipped, and a
failed signature check is indistinguishable from an attack, so nothing would say
why. `x-ortha-` also stays **reserved** for endpoint-supplied custom headers, or
an operator could overwrite the older spelling of the signature.

Move receivers to `X-Apograph-*` before the next major version.

## What you must do yourself

1. **Update the dependency names** in your `package.json`: `@orthacms/x` →
   `@apograph/x`, same version.
2. **Rename your host config** — `ortha.config.ts` → `apograph.config.ts`. The
   CLI and the Nx plugin both locate the host by this filename, so this one is
   not optional.
3. **Rename the CLI in your scripts** — `ortha dev` → `apograph dev`, and the
   same for `build` / `start` / `migrate` / `generate` / `studio`.
4. **Local Postgres**, for a development checkout only: `docker-compose.yml` now
   creates the database `apograph_cms` with the role `apograph`. An existing
   volume still holds `ortha_cms`, and Postgres only runs its init scripts on an
   empty data directory — so `docker compose down -v && docker compose up -d`,
   then `npx nx run server:db:migrate`. A **deployed** database needs none of
   this: point `DATABASE_URL` at it as before.
5. **Rename the env variables** when convenient — the fallback buys time, it is
   not a destination.
6. **MCP clients** that hardcode an `ortha://` resource URI need the new scheme.
   A client that discovers resources through `resources/list` needs nothing.

## Still named `ortha-source`

The GitHub and Linear organisation slug is unchanged, so
`github.com/ortha-source/...` and `linear.app/ortha-source/...` are left as they
are throughout the repository. Commit links and `ORT-` ticket references still
resolve.

The **repository** name in those URLs was updated to `apograph-cms`, which is
only correct once the repository is renamed on GitHub. Do that before merging,
or the links point at nothing. GitHub redirects the old name afterwards, so
existing clones keep working.
