# docs-guard

The root documents describe the whole system, so they are the first thing a new
reader opens — and the last thing anyone remembers to update. This project makes
the **countable** half of that unforgettable: every claim in `ARCHITECTURE.md`
and `CONTEXT-MAP.md` that is a number, a list, or a set of names is derived from
the code and compared, rather than re-read by a human.

`npx nx test docs-guard` — no database, no build, ~0.5s. It runs in the same
`nx run-many -t test` CI step as everything else.

## Why it exists

A qualification pass found the root documents to be the least accurate files in
the repository while the per-package dossiers were fresh: the shared database
plugin was said to own no schema, `ServerPlugin` to have four fields, the Content
Library to define five slots, the session cookie to hold a signed token. Every
one of those was corrected by hand once. Nothing stopped them drifting again, and
the first thing this guard found when it was written was that `copilot/server`
had grown a fifth table while the map still said four.

Prose cannot be pinned this way and is not attempted. A number can.

## What it pins

| Claim                                                 | Derived from                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| The Content Library defines _n_ slots, in four groups | `createSlot(...)` calls in `content/admin`, grouped by slot id |
| `ServerPlugin` / `AdminPlugin` have these fields      | the TypeScript declarations, read through the compiler API     |
| Each group ships _n_ `provider-*` adapters            | the `packages/<group>/provider-*` directories                  |
| These groups ship a framework-free `domain` kernel    | the `packages/*/domain` directories                            |
| Plugin _x_ owns _n_ tables (or none, or these names)  | its committed migrations, replayed `CREATE` / `DROP` in order  |
| The project map lists every project, by its npm name  | the `apps/`, `packages/` and `tools/` directories              |
| The skill list names every skill                      | `.agents/skills/`                                              |

## How a claim is pinned

A claim is found by a **regular expression over the sentence**, not by a marker
in the markdown. The documents stay ordinary prose that renders on GitHub, and
nobody has to know this project exists to edit them.

The trade is that a reworded sentence stops matching — so `claimIn` fails when a
pattern matches **zero** times just as loudly as when the number is wrong.
Silence would mean the guard had quietly stopped pinning anything, which is the
state it exists to end. Reword freely; re-point the pattern in the same commit.

Three details worth not re-discovering:

- **Documents are read with whitespace collapsed.** They are hard-wrapped at 80
  columns, so a claim and its number routinely sit on different lines and a
  pattern written against the rendered sentence matches nothing. Collapsing
  first also means a pattern survives a re-wrap — the one edit guaranteed to
  happen to a sentence someone corrects. The exceptions are the two places
  formatting carries meaning: a fenced code block (checked line by line) and a
  markdown table (a row per line).
- **Numbers are read as digits _or_ words.** The same sentence writes the total
  as `**14**` and the breakdown as `five` / `seven` / `one`; a guard that
  understood one spelling would leave the other free to drift.
- **Table ownership comes from the migrations, not the schema modules.** A
  plugin may declare a `pgTable` for a table another plugin creates, purely to
  have something to reference — copilot's `external-refs.ts` declares `users`
  and `workspaces` that way — and counting those would credit it with tables it
  does not migrate.

## Why `tools/` and why a `project.json`

It is workspace tooling, not a package: nothing imports it and nothing publishes
it, so `packages/` would have put it in front of `nx release`'s `@orthacms/*`
glob for no reason.

It carries a `project.json` rather than a `package.json` because `@nx/jest`
refuses to infer a target from a `package.json` outside the npm `workspaces`
globs (`packages/*`, `packages/*/*`) — the project appears in the graph with a
`typecheck` and a `lint` target and no `test`, which fails as a missing target
rather than as a failing one.
