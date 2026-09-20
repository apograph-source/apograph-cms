# Parallel dev stacks (one per worktree)

Running several tickets at once — typically one agent per ticket, each wanting
a live app to verify against — means several **full stacks** running side by
side: API, admin, and a database each. This document is how that is set up
here, and where the ceiling is.

The mechanism is a **slot**: an integer that fixes one checkout's ports and
database.

| slot | API    | admin  | database       |
| ---- | ------ | ------ | -------------- |
| 0    | `3000` | `4200` | `ortha_cms`    |
| 1    | `3001` | `4201` | `ortha_cms_a1` |
| _n_  | `300n` | `420n` | `ortha_cms_an` |

Slot 0 is the main checkout and is managed by hand — the defaults every command
already assumes. Slots 1–9 are provisioned by
[`tools/worktree/slot.mjs`](../tools/worktree/slot.mjs).

## One Postgres, many databases

Slots do **not** get their own container. Five Postgres containers cost five
times the memory to isolate data that `CREATE DATABASE` already isolates, and
they would force `docker-compose.yml` to parameterise its container name, host
port and volume. So every slot shares the one `docker compose up -d` server and
owns a database inside it. Migrations are per-plugin and applied by the host, so
each database bootstraps independently:

```sh
npx nx run server:db:migrate
```

## Setting up a slot

```sh
# from the main checkout — one worktree per ticket
git worktree add ../ortha-cms-ort-101 -b claude/ort-101-something

# provision it: creates the database, writes a port-adjusted .env
node tools/worktree/slot.mjs provision 1 --path ../ortha-cms-ort-101

# then, inside that worktree
cd ../ortha-cms-ort-101
npm install                     # worktrees start without node_modules
npx nx run server:db:migrate
npm run dev
```

`provision` copies the main checkout's `.env` verbatim — secrets included, so
the stack actually boots — and rewrites only `PORT`, `ADMIN_PORT` and the
database name in `DATABASE_URL`. The file is git-ignored; keep it local.

`npm run worktree -- list` prints every worktree with its ports, database, and
whether anything is listening, plus any databases no worktree still claims.

When a ticket is done:

```sh
node tools/worktree/slot.mjs release 1 --yes   # drops ortha_cms_a1
git worktree remove ../ortha-cms-ort-101
```

## What reads the slot

Three files, all of which default to slot 0 so nothing changes for a single
checkout:

- [`apps/admin/vite.config.mts`](../apps/admin/vite.config.mts) — serves on
  `ADMIN_PORT` and proxies `/api` to `API_PORT` (falling back to `PORT`). The
  proxy target is the one that matters: pinned to `3000`, a second worktree's
  admin would serve its own UI while reading and writing the **first**
  worktree's database. `strictPort` is on, so a taken port fails instead of
  drifting to the next free one behind an agent's back.
- [`apps/server/ortha.config.ts`](../apps/server/ortha.config.ts) — the
  `ALLOWED_ORIGINS` default follows `ADMIN_PORT`.
- [`apps/admin-e2e/playwright.config.ts`](../apps/admin-e2e/playwright.config.ts)
  — `baseURL` and the `webServer` URL follow `ADMIN_PORT`, so a suite tests its
  own stack. (`BASE_URL` still overrides both.)

`apps/server-e2e` needs nothing: it boots a Postgres **testcontainer** on a
random port, so it was already parallel-safe.

## How many slots actually fit

Fewer than you would like. One `npm run dev` is four continuous tasks — webpack
watch, `node --watch`, Vite, and `tsc --build --watch` — which is roughly
1.5–2.5 GB and most of a core under load, before an agent-browser Chrome on top.

On a 4-core / 8 GB machine that is **two concurrent stacks**, three at a
stretch. The workable shape for five tickets is therefore five worktrees, which
cost only disk, over a **pool of two slots**: agents write code in parallel and
take a slot when they need a live app to verify against. Nothing in the tooling
enforces the pool — it is a scheduling decision, and `list` is there to show
who currently holds what.

`npm install` per worktree is unavoidable: this is npm workspaces with
`customConditions: ["@orthacms/source"]` resolution, and symlinking a shared
root `node_modules` breaks it.
