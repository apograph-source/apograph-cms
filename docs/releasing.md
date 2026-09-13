# Releasing to npm

Every package under `packages/` is published to the `@apograph` scope in one
lockstep release: one version, one tag, one GitHub Release, 37 tarballs.

## Running a release from your machine

Check out `main`, pull, and run:

```sh
npm run release:dry-run     # rehearse — writes nothing, pushes nothing, publishes nothing
npm run release             # version → changelog → tag → push → publish → GitHub Release
npm run release:publish     # publish only, to finish a partly failed release
npm run release -- 1.2.0    # force a version instead of deriving one
```

`nx release` asks for confirmation before it publishes. **Read that prompt.**
A publish cannot be undone and a version number can never be reused; the
prompt is the last point at which a mistake is free. Pass `--yes` only for an
unattended run.

### Credentials

Both live in `.env` at the workspace root, which is git-ignored.
[`.env.example`](../.env.example) documents them. `tools/release/release.mjs`
loads the file before handing off; anything already exported in your shell
wins over it.

|                |                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN`    | An npm automation token with publish rights on the `@apograph` scope. It is handed to npm as configuration in the child process, never written to an `.npmrc`. Leave it empty to publish as whoever `npm login` logged in as. |
| `GITHUB_TOKEN` | A token with `repo` access. `nx release` creates the GitHub Release with it.                                                                                                                                                  |

### What it refuses to do

`nx release` commits, tags and **pushes** the new version before it publishes
or creates the release, so a problem found at that point leaves a tagged
commit and an empty registry. The preflight checks therefore run first and
refuse to start when you are not on `main` (override with `--allow-branch`),
the working tree is dirty, the branch is behind `origin/main`, npm has no
usable credentials, or `GITHUB_TOKEN` is missing.

## Running it from CI

The **Release** workflow in the Actions tab does the same thing unattended:
leave the version input empty to derive the bump, or type an explicit one, and
tick **dry-run** to rehearse. It needs one repository secret, `NPM_TOKEN`.

## What is released

|            |                                                                     |
| ---------- | ------------------------------------------------------------------- |
| Scope      | every project matching `@apograph/*` except `@apograph/nx`          |
| Versioning | **fixed** — all packages move together, always the same version     |
| Specifier  | conventional commits (`feat:` → minor, `fix:` → patch, `!` → major) |
| Tag        | `v{version}`                                                        |
| Changelog  | one workspace-level `CHANGELOG.md`, no per-project files            |

`@apograph/nx` is `private` and stays out: it is workspace tooling, wired
into this repo's `nx.json`, not something a consumer installs.

The apps (`apps/admin`, `apps/server`) are private and never publish. They are
the reference host, not a distributable.

### The scaffolder's template needs no version edit

`create-apograph-app` writes every `@apograph/*` dependency as `__APOGRAPH_VERSION__`
and stamps it with **its own version** at scaffold time, so a release carries
the generated app forward with nothing to update by hand. There is no list of
versions in the template to fall behind.

What a release *does* assume is that the template knows about every package.
Adding one to the workspace without classifying it in
[`packages/create-apograph-app/src/lib/features.ts`](../packages/create-apograph-app/src/lib/features.ts)
fails `create-apograph-app`'s tests — deliberately, so the decision "does a new app
get this?" is made when the package is written rather than discovered by a user
months later.

`create-apograph-app` is the one published package **outside** the `@apograph`
scope — unscoped so `npx create-apograph-app` works — so it is named explicitly in
`release.projects` and in the `preVersionCommand` rather than being picked up by
the `@apograph/*` glob. It ships in lockstep for a reason beyond tidiness: it
stamps its own version into every `@apograph/*` dependency of the app it
generates, so its version *is* the matching set.

## How a tarball is built

Workspace packages are consumed **from source** — their `exports` point at
`./src/index.ts` and `tsconfig.base.json` supplies the `@apograph/source`
condition (see [AGENTS.md](../AGENTS.md), "How packages resolve"). A consumer
installing from npm has neither, so the checked-in manifest is not the one
that ships.

Three inferred targets do the work; all three come from
[`@apograph/nx`](../packages/nx/AGENTS.md), so a new package gets them by
existing.

1. **`build`** — `tsc --build tsconfig.lib.json`, emitting JS and `.d.ts` into
   the package's `dist/`. Server packages compile to CommonJS, which is what
   their `nodenext` module setting and the absent `"type": "module"` add up
   to; admin packages compile to ESM for a bundler, which is the only way
   they are ever consumed.
2. **`pack`** — [`tools/release/pack.mjs`](../tools/release/pack.mjs) assembles
   a publishable package root at `dist/pack/<projectRoot>/`: the build output,
   any non-TS asset that sat beside the source (`styles.css`), the
   `migrations/` folder if the plugin ships one, the `templates/` folder if it
   ships those, the LICENSE and README, and a **rewritten `package.json`** whose
   `exports` point at `./dist`, whose `bin` is remapped the same way `main` is,
   and whose workspace dependencies are pinned to the released version instead
   of `"*"`.

    `bin` is remapped and then **verified**, along with every other declared
    entry point. Left pointing at `./src/cli.ts` it publishes a command that
    installs cleanly and dies on its first `npx`, on someone else's machine,
    with an error about the command not existing rather than about the file.
3. **`nx-release-publish`** — publishes that staging directory rather than the
   project root, via `packageRoot`. It runs `@apograph/nx:release-publish`
   rather than the `@nx/js` one, because 37 publishes in a row is more than
   npm will take at full speed — see [Rate limits](#rate-limits) below.

The staging directory lives at the workspace root, not beside the package, on
purpose: the root `workspaces` globs cover `packages/*`, so a staging
directory inside a flat package is read as a second workspace of the same
name, and npm then refuses to run at all.

## Rate limits

npm rate-limits how fast one account may write, and a lockstep release asks it
to accept 37 tarballs back to back. Published as fast as Nx can schedule them,
the registry starts answering **429 Too Many Requests** partway down the list —
and by then the version is already committed, tagged and pushed, so the repo
says a release happened that the registry only half has.

So a publish is not a plain `npm publish`. Each one takes a turn through a
workspace-wide slot — a file lock under `dist/.release-publish` — which
serialises the publishes no matter what Nx's task parallelism is doing, and
leaves a gap between them. A publish the registry refuses for its own reasons
(a 429, a 5xx, a dropped connection) is retried with an exponential backoff; a
publish refused for ours — a bad manifest, a missing entry point, a rejected
token — fails on the first attempt, because retrying it just takes longer to
tell you the same thing.

The defaults are a **5 second gap**, **5 retries** starting at 30 seconds and
doubling to a 5 minute ceiling. That adds roughly three minutes to a clean
release. To go slower (or faster) for one run:

```sh
APOGRAPH_PUBLISH_DELAY=10000 APOGRAPH_PUBLISH_RETRIES=8 npm run release
```

`APOGRAPH_PUBLISH_RETRY_BACKOFF` moves the first backoff. A dry run waits for
nothing — it writes nothing there is a limit on.

Two consequences worth knowing:

- **A version already on the registry counts as success.** Before publishing,
  the executor asks the registry what it already has — a `GET`, which npm does
  not meter the way it meters writes. A version that is already there is
  skipped without sending anything at all. That is what makes
  `npm run release:publish` a safe and cheap way to finish a release that died
  halfway: a resume that only has 12 packages left spends 12 writes, not 37.
  (A republish that slips through anyway is still caught: npm answers it with a
  403, which the executor also reads as "this one already went out".)
- **A failed publish is reported per package.** Nx fails the run, the packages
  that made it are on the registry, and re-running `npm run release:publish`
  picks up the rest.

### Creating a package name is a different limit

Everything above is about how _fast_ an account writes, and spacing fixes it.
Creating a **brand-new package name** is metered separately and much more
tightly, and that one no amount of waiting or retrying gets around.

We found this the hard way. The 0.1.0 release created 25 names in 32 seconds
and then npm refused the remaining 12 — and went on refusing them through 0.2.0
and 0.2.1, while version bumps on the 25 names that already existed kept going
through untouched in the same runs. An hour of a completely idle account did
not clear it; a bump published fine seconds after a creation was refused.

So the executor tells the two apart. The registry probe already knows whether a
publish would create a name or add a version to one, and:

- a 429 on a **version bump** is transient — retried with backoff, as above;
- a 429 on a **name creation** is terminal — reported once, with no retry ladder,
  because twelve minutes of backoff only buys the same answer;
- the first name to be refused trips a flag beside the lock, so the packages
  queued behind it bow out without spending a request of their own. One blocked
  release costs **one** rejected write, not one per package.

When you hit it, the release is telling you something it cannot fix. Ask npm
support to raise the new-package limit for the account — and, while that is
unanswered, stop letting the release be the thing that creates names.

#### Seeding the names ahead of the release

`npm run release:reserve` creates the missing `@apograph/*` names on its own,
in batches, so that by the time a release runs every publish is a version bump
— the case the gap and the backoff above already handle.

```sh
npx nx run-many -t build,pack --projects=@apograph/*
npm run release:reserve -- --dry-run        # probe and report, write nothing
npm run release:reserve -- --limit=20       # create at most 20 names
```

Each run probes the registry, skips every name that is already there, and
publishes the **real staged tarball** at `0.0.0-reserve.0` under the `reserve`
dist-tag. Two things follow from that choice. `latest` stays unset, so
`npm install @apograph/<name>` finds nothing until the real release rather
than installing a husk; and what goes out is a genuine package rather than an
empty placeholder, which is what an anti-abuse system reads as squatting — the
last thing to do while rationed. The reserved version does not disturb
versioning: `nx release` derives the next one from conventional commits against
the git tag and never asks the registry.

The first refusal ends the run. The names queued behind it are reported, not
attempted: every rejected creation is a signal to the rate limiter, and
spending one per package to be told the same thing is how a soft limit becomes
a hard one. Run it again when the limit rolls over — what already exists is
skipped by the probe.

`--limit` is also how you find out what the limit actually _is_, which npm does
not document. Start at 20; where the refusal lands is the answer, and it costs
one write to learn.

The same script points anywhere: `--registry=http://localhost:4873` rehearses
the whole thing against a local Verdaccio, which has no limits at all and
proves the tarballs install before a single metered write goes out.

### Two things `pack` refuses to ship

Both were real bugs when this was set up, and both fail the release rather
than reaching the registry.

- **An entry point that was not built.** Every path in the generated `exports`
  must exist in the staging directory.
- **A phantom dependency.** A package that imports something only the
  _workspace root_ declares resolves fine here — npm hoists it — and is simply
  missing from a consumer's tree. Type-only imports count; they end up in the
  `.d.ts`.

## Adding a package

Nothing to wire up. Put it under `packages/` with a `package.json` and a
`tsconfig.lib.json` and it joins the next release. Declare every dependency it
imports in its **own** manifest — `pack` will not let a phantom through — and
give `react`/`react-dom` as `peerDependencies` for an admin package, matching
its siblings.
