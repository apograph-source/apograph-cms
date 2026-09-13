# Contributing

Apograph CMS is MIT licensed, and every package in `packages/` states that
licence in its own `package.json`. A release refuses to stage a package that
omits the field or names a different licence (`tools/release/pack.mjs`), so
the licence a consumer's scanner reads off a tarball is always the one this
repository declares.

## Sign your commits

Every commit needs a `Signed-off-by` line certifying the
[Developer Certificate of Origin](DCO): that you wrote the change, or have the
right to submit it, under the project's licence. Git adds the line for you:

```sh
git commit -s
```

The `commit-msg` hook installed by `lefthook` (`npm install` runs
`lefthook install`) rejects a commit without it, so the requirement is met
before a pull request is opened rather than discovered in review.

The sign-off is the only agreement contributors make. There is no
contributor licence agreement and no copyright assignment: your contribution
stays yours, licensed to the project under MIT like everything else here.
That is also what keeps a future licensing decision — a separately licensed
paid plugin, say — honest: it can only ever cover code the project's own
authors wrote, never a contribution that was offered under MIT.

## Where the conventions live

Authoring conventions are encoded as skills under `.agents/skills/`
(`server-plugin`, `admin-plugin`, `accessibility`, `admin-e2e`, `server-e2e`,
`shadcn`). Before changing a plugin, read its package `AGENTS.md` and the
relevant skill. Recurring pitfalls to avoid are listed in
[`.cursor/BUGBOT.md`](.cursor/BUGBOT.md), and the reasons things are the way
they are in [`docs/adr/`](docs/adr/README.md).

## Before you push

```sh
npx nx affected -t lint,typecheck,test
```

Prettier is the formatter: 4-space indent, single quotes. A change to a
plugin's schema needs its migration generated and committed
(`npx nx run <plugin>:db:generate --name=<name>`).
