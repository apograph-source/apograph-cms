# The agent pipeline

How a ticket becomes a merged pull request when agents do the typing. This
document is the **routing table**, and the `ticket` skill reads it rather than
restating it — so a tier changed here changes behaviour, and there is one place
to look when a run cost more than it should have.

The shape is four **tiers**. A tier fixes three things a run would otherwise
decide for itself: which agents start, whether a human approves before
implementation, and how many QA cycles are allowed before the work escalates.

## Why tiers, and why not by ticket type

The obvious split — feature gets the full treatment, bugfix gets a shortcut —
routes by the wrong signal. A bugfix in `protection` can touch `domain`,
`server`, `admin` and a migration at once; that is the most expensive class of
work there is. A feature can be one filter control in one admin table. Routing
by type systematically under-serves the expensive bugs and over-serves the cheap
features.

What actually drives cost here is three things:

1. **How many surfaces change.** One of `*/server` or `*/admin` is a single
   agent's job. Both means an API contract has to be agreed before either side
   writes code, or the two halves are built against different guesses and the
   mismatch surfaces at QA — the most expensive place to find it.
2. **Whether a live stack is needed.** `apps/admin-e2e` mocks `/api` at the
   network layer, so it proves the UI against a fixture, not against the server.
   Anything whose acceptance criteria are about real end-to-end behaviour needs a
   provisioned slot ([`parallel-stacks.md`](parallel-stacks.md)), Postgres, and
   seeded data.
3. **Whether there are structural consequences.** Those are not vague here: a
   new table, slot or package moves a number that `tools/docs-guard` pins
   against `ARCHITECTURE.md` and `CONTEXT-MAP.md`, and a new published package
   must be classified in `create-apograph-app`'s `features.ts` or a test stays
   red. That is a known, enumerable checklist — exactly what deterministic
   routing is for.

## The tiers

| Tier   | What it is                                                                         | Plan                       | Agents                  | QA                                  | Cycles | Human gate                |
| ------ | ---------------------------------------------------------------------------------- | -------------------------- | ----------------------- | ----------------------------------- | ------ | ------------------------- |
| **t0** | copy, i18n messages, docs, a dependency bump                                       | none                       | the lead alone          | CI                                  | 0      | PR review                 |
| **t1** | one surface: only `*/server` **or** only `*/admin`                                 | a short note on the ticket | one role agent          | CI + `code-review`                  | 1      | PR review                 |
| **t2** | both surfaces — the typical feature                                                | full, **contract frozen**  | backend + frontend + qa | live slot + e2e                     | 2      | plan approved first       |
| **t3** | a new package, table or migration; `auth`, `permissions`, `protection`, `segments` | full, **+ ADR question**   | + a security pass       | live slot + e2e + `security-review` | 2      | plan **and** SQL approved |

Model effort follows the tier: t0 and t1 do not need the strongest model, t2 and
t3 do.

## Who decides the tier

**The label decides. The lead only proposes one when the label is absent.**

Choosing a tier is choosing a budget, and a budget decided afresh by a model on
every ticket is neither reproducible nor auditable: a month later nobody can say
why one ticket burned forty agent runs. A model asked "how thorough should this
be?" also drifts upward over time, because thorough always feels safer.

So the lead's discretion is deliberately narrow and asymmetric:

- **No label, and the lead reads it as t0 or t1** — it applies the label, says
  why in one line, and proceeds. A wrong guess here is cheap.
- **No label, and the lead reads it as t2 or t3** — it applies the label and
  **stops**. A wrong guess here is not cheap.
- **A label is present** — the lead uses it and does not argue. A human
  overriding the tier is the point of the label existing.

One free audit rides on top: after the plan is written, the lead compares the
tier against what the plan actually found. "Labelled t1, but the plan touches
both surfaces" goes on the ticket as a comment. It catches mislabelling by
humans and costs nothing.

## Labels

One mutually exclusive **group**, `agent-tier`, holding `t0` … `t3`. Linear's
label groups give that exclusivity natively; four free-standing labels do not, and
without it a ticket eventually carries `t1` and `t3` at once and the lead has to
guess. Create the group and the three signal labels below before the first run —
the lead reads the vocabulary, it does not invent it.

Three signal labels alongside it:

| Label              | Meaning                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `agent:needs-spec` | The ticket failed [Definition of Ready](definition-of-ready.md). The lead posts what is missing and stops. |
| `agent:escalated`  | The cycle limit was reached without progress. A human takes over.                                          |
| `agent:no-auto`    | Hands off. The lead does not act on this ticket at all.                                                    |

`agent:needs-spec` earns its place more than the other two. The dominant failure
mode of a pipeline like this is agents building confidently from an
under-specified ticket; the label puts that failure on the board instead of
burying it in a comment thread.

The store is **Linear**, and screenshots are why that is not a matter of taste:
Linear takes real attachments on an issue, where the GitHub Issues API has no
endpoint for attaching an image at all. A pipeline whose evidence cannot reach the
ticket is a pipeline nobody can audit, so GitHub Issues is not a fallback and must
not be used as one. Linear's connector has to be authorised in an interactive
session; with it unreachable the lead stops rather than improvising.

The tier and the actual cost — runs spent, QA cycles used — are written **back**
to the ticket when a run finishes. Without that there is no way to answer the
only question that decides whether any of this was worth building: does t2 beat
one agent and a careful review?

## The agents

The lead runs in the **main session** as the `ticket` skill, not as a subagent: a
subagent cannot spawn subagents, and spawning them is the lead's entire job.

| Who        | Where                        | Context  | Owns                                                             |
| ---------- | ---------------------------- | -------- | ---------------------------------------------------------------- |
| `ticket`   | `.agents/skills/ticket/`     | main     | triage, fan-out, assembling the plan, cycle counting, escalation |
| `backend`  | `.claude/agents/backend.md`  | isolated | `packages/*/server`, `packages/*/domain`, migrations             |
| `frontend` | `.claude/agents/frontend.md` | isolated | `packages/*/admin`, `apps/admin`                                 |
| `qa`       | `.claude/agents/qa.md`       | isolated | the live slot, the acceptance criteria, `apps/*-e2e`             |
| `open-pr`  | `.agents/skills/open-pr/`    | main     | pushing the branch and writing the PR body                       |

The three role agents live only under `.claude/` because the subagent format is
Claude-specific — unlike skills, which are tool-agnostic and therefore
canonically in `.agents/skills/` with `.claude/skills/` mirroring them by
symlink.

**`qa` has no write access to `packages/`.** It may only write under
`apps/*-e2e`. Without that line the distinction between "found a bug" and
"rewrote the feature until my test passed" does not survive contact with a
failing assertion.

## The steps

| #   | Step           | Who                                      | In                      | Out                                                     | Gate                            |
| --- | -------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------- | ------------------------------- |
| 0   | Triage         | lead                                     | the ticket              | a tier label, or `agent:needs-spec`                     | t0/t1 proceed; t2/t3 stop       |
| 1   | Analysis       | backend ‖ frontend ‖ qa, **read-only**   | ticket + code           | three notes: what is touched, risks, open questions     | —                               |
| 2   | Plan           | lead                                     | the three notes         | a ticket comment: **contract** + breakdown + invariants | t2/t3 — a human approves        |
| 3   | Contract       | backend                                  | the plan                | DTOs, routes, permission constants, on the branch       | frontend does not start earlier |
| 4   | Implementation | backend → frontend                       | the contract            | commits on **one** branch                               | —                               |
| 5   | Self-check     | whoever wrote it                         | own diff                | `nx typecheck` / `lint` / `test` green                  | red does not leave this step    |
| 6   | PR             | `open-pr`                                | the branch              | a PR with a diff-tailored manual checklist              | CI                              |
| 7   | Review         | `code-review`, + `security-review` at t3 | the diff                | findings, applied                                       | —                               |
| 8   | QA             | qa                                       | slot + PR               | failing tests, or "clean"                               | see below                       |
| 9   | Fix            | backend / frontend                       | the failing tests       | a push                                                  | → step 8                        |
| 10  | Escalation     | lead                                     | two cycles, no progress | a comment + `agent:escalated`                           | a human takes over              |

Steps 5–7 are the same at every tier. Step 8 runs at t2 and t3 only.

One branch, one PR per ticket. Splitting a ticket's server and admin halves into
two PRs makes the admin PR green against mocks while the feature does not work,
which is worse than a red one.

## The QA cycle

| Aspect                      | Rule                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stack                   | `npm run worktree -- provision <slot>`, then `npm run dev`. Never `admin-e2e` alone — its `/api` is mocked.                                                                                                                       |
| The pass                    | The ticket's acceptance criteria, driven through `agent-browser`.                                                                                                                                                                 |
| The invariants              | The numbered lists ending each dossier in [`artifacts/`](artifacts/) for the packages the diff touches.                                                                                                                           |
| **A bug is a failing test** | No reproducing test under `apps/*-e2e` means it is an observation for a comment, not a sub-ticket.                                                                                                                                |
| Evidence                    | A screenshot per criterion; one per step for a multi-step criterion, numbered; a failure also gets the moment it broke plus the Playwright trace. Video only where the defect exists as a sequence rather than a state.           |
| The report                  | One comment when the cycle ends — criteria with verdicts, failing tests, observations without a test, and whether the failing set shrank. Posted **before** the ticket is closed, because it is what the close decision rests on. |
| Out                         | Failing tests plus sub-tickets, or "clean".                                                                                                                                                                                       |
| Stop                        | The set of failing tests did not shrink for two cycles running → step 10.                                                                                                                                                         |

The failing-test rule is the only cheap filter against the pipeline's second
failure mode: an agent generating bug reports from its own mistaken
expectations, each one starting a fix cycle that breaks something real. It pays
for itself twice, because the fix agent then receives a red test instead of a
description, and "done" becomes machine-checkable.

Counting cycles by **absence of progress** rather than by "bugs still appearing"
matters for the same reason. Two cycles where the failing set does not shrink is
a stall; waiting for a third only makes the escalation more expensive.

## Escalating

An escalation is not "it did not work". It is a comment naming what was
attempted, what is still red, and two hypotheses for why — enough for whoever
picks it up to start from the second hour rather than the first.

## Rollout

The tiers describe the finished pipeline. The steps are switched on in stages,
because six moving parts cannot be debugged at once and most pipelines of this
shape die on their first real ticket:

| Stage | What runs            | Why this order                                                                                                                           |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | steps 0–2, then stop | A bad plan is visible immediately and costs almost nothing; bad code is expensive. This is the highest-value part of the whole pipeline. |
| 1     | steps 3–7            | Implementation in one branch, finishing through `open-pr`. A human still merges.                                                         |
| 2     | step 8               | QA on a live slot, with the failing-test rule.                                                                                           |
| 3     | steps 9–10           | The automatic fix cycle, once stages 0–2 are stable.                                                                                     |

The metric that decides whether to advance a stage is how many times a human had
to intervene per ticket. If stage 1 needs three interventions, stage 2 will
multiply that number, not reduce it.
