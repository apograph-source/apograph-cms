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
`shadcn`, `agent-browser`), mirrored into `.claude/skills/` by symlink. Two more
are procedures rather than conventions: `open-pr` writes a pull request body from
the diff, and `ticket` drives the pipeline below. Before changing a plugin, read
its package `AGENTS.md` and the relevant skill. Recurring pitfalls to avoid are listed in
[`.cursor/BUGBOT.md`](.cursor/BUGBOT.md), and the reasons things are the way
they are in [`docs/adr/`](docs/adr/README.md).

## Working a ticket with the agent pipeline

Tickets live in **Linear**. The pipeline routes each one by blast radius into one
of four tiers, and the tier decides which agents start, whether a human approves
the plan before implementation, and how many QA cycles are allowed. The routing
table is [`docs/agent-pipeline.md`](docs/agent-pipeline.md); what a ticket must
contain before any of it runs is
[`docs/definition-of-ready.md`](docs/definition-of-ready.md).

**1. Write the ticket** to the Definition of Ready: the behaviour change stated
as behaviour, who it is for, acceptance criteria as a checkable list, and one line
of what is out of scope. Set the `area` label if you already know where it lives —
it saves the analysis a pass, and guessing wrong costs nothing.

**2. Triage and plan.**

```
/ticket ORT-123
```

The lead applies an `agent-tier` label, fans a **read-only** analysis out to the
`backend`, `frontend` and `qa` agents, and posts one plan to the ticket: the
frozen API contract, the breakdown, the invariants the change must not break, and
what QA will verify. On a t2 or t3 ticket it then **stops**.

**3. Read the contract.** This is the step the rest is built around — ten minutes
of reading catches a wrong contract that would otherwise surface days later as
rework. Either it is right, or you correct it in a ticket comment and the
implementation builds against your version. A ticket that failed the Definition
of Ready comes back labelled `agent:needs-spec` naming what is missing, instead of
a plan; fix the ticket and run step 2 again.

**4. Implement.**

```
/ticket ORT-123 go
```

`backend` lands the contract first and `frontend` starts only once it exists in
code, because two halves built against different guesses fail at QA — the most
expensive place to find it. Each role runs the repo's own checks before handing
back, and the branch finishes through `open-pr` and `code-review` (plus
`security-review` at t3).

**5. Verify.** At t2 and t3 this follows step 4 on its own; run it explicitly to
repeat a cycle:

```
/ticket ORT-123 qa
```

`qa` provisions a slot, drives the acceptance criteria through a real browser, and
posts a report carrying a screenshot per criterion. A defect it can reproduce
becomes a failing test and a sub-issue; one it cannot stays an observation in a
comment.

**6. Fix cycles run without you.** Step in when the ticket is labelled
`agent:escalated`: two cycles passed without the set of failing tests shrinking,
and the comment says what was tried and what is still red.

**7. Review the pull request and merge.** Merging is never the pipeline's, and
neither is moving a ticket's status.

`/ticket ORT-123 status` reports where a ticket stands, which tier it took, and
how many cycles it has spent.

### What this costs you

t0 and t1 interrupt you once, at the pull request. t2 interrupts you twice — the
plan, then the pull request. t3 is t2 plus the migration SQL approved on its own,
because a migration is the one change that is irreversible in production.

What stops being yours: plugin skeletons, DTOs, hooks, e2e scaffolding, the pull
request body, running the checklists. What stays yours: the contract between
server and admin, the SQL of a migration, whether the change is what the product
needs, and the merge.

Two limits are physical rather than policy. **Two** concurrent t2/t3 tickets is
the ceiling, because QA needs a live slot and a 4-core machine holds two
([`docs/parallel-stacks.md`](docs/parallel-stacks.md)). And the pipeline has
processed no tickets yet: run the first few to step 3 and stop, and switch on a
later stage only once the planning step stops needing correction.

## Before you push

```sh
npx nx affected -t lint,typecheck,test
```

Prettier is the formatter: 4-space indent, single quotes. A change to a
plugin's schema needs its migration generated and committed
(`npx nx run <plugin>:db:generate --name=<name>`).
