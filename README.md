# Ortha CMS

[orthacms.com](https://orthacms.com) · [Documentation](https://orthacms.com/docs) · [Quick start](https://orthacms.com/docs/start/quickstart)

A plugin-based CMS built as an [Nx](https://nx.dev) monorepo. A small, generic
**host** turns a list of **plugins** into a running app — capability lives in
plugins, not in the host.

- **`apps/admin`** — React 19 + Vite admin SPA
- **`apps/server`** — NestJS API
- **`packages/*`** — plugins (auth/identity, users, workspaces, activity),
  hosts, the design system, and tooling

## Documentation

| Doc                                  | What it covers                                                           |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [`AGENTS.md`](AGENTS.md)             | Canonical context: layout, commands, conventions (read by all AI agents) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the system is built — plugin hosts, data layer, request flow         |
| [`CONTEXT-MAP.md`](CONTEXT-MAP.md)   | Project map (every app & package) + glossary                             |
| [`DESIGN.md`](DESIGN.md)             | Product & design intent                                                  |
| [`docs/adr/`](docs/adr/README.md)    | Architecture Decision Records — the _why_                                |

The reference for people **using** Ortha CMS rather than working on it is the
documentation portal at [orthacms.com/docs](https://orthacms.com/docs).

## Getting started

Prerequisites: Node, npm, Docker.

```sh
# 1. Install
npm install

# 2. Configure — copy the example env and set DATABASE_URL
cp .env.example .env

# 3. Start Postgres
docker compose up -d

# 4. Apply database migrations (every plugin's pending migrations)
npx nx run server:db:migrate

# 5. Run the apps
npx nx serve server
npx nx serve admin
```

The running server documents itself: the interactive API reference is at
<http://localhost:3000/reference> (raw OpenAPI at `/reference/json`). It is on
outside production — set `API_DOCS=true` to publish it from a deployment, or
`API_DOCS=false` to turn it off locally.

## Common tasks

```sh
npx nx <typecheck|build|lint|test|serve> <project>   # any task on any project
npx nx sync                                          # after changing cross-project deps
npx nx graph                                         # visualize the project graph

# Database / migrations (provided by @orthacms/nx)
npx nx run <plugin>:db:generate --name=<name>        # generate a plugin's migration
npx nx run server:db:migrate                         # apply all pending migrations
```

Package manager is **npm workspaces**. Formatting is Prettier (4-space indent,
single quotes).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: sign every commit
(`git commit -s`) to certify the [Developer Certificate of Origin](DCO), and
before changing a plugin read its package `AGENTS.md` and the relevant skill
under `.agents/skills/`. Recurring pitfalls to avoid are listed in
[`.cursor/BUGBOT.md`](.cursor/BUGBOT.md).

## Licence

MIT, for every package. Each `package.json` states it, and a release refuses
to stage a package that omits the field or names a different licence.
