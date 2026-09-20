# 0010 — Skills are prompt configuration, authored in two places and delivered in one

- **Status:** Accepted
- **Date:** 2026-08-11
- **Deciders:** Engineering

> Extends [ADR-0005](0005-copilot-authority-model.md) and
> [ADR-0009](0009-copilot-applies-directly.md). Nothing in either is replaced:
> a skill changes **how** the copilot works and never **what it may do**, and
> the capability profile remains the only answer to the second question. This
> record reintroduces per-workspace copilot configuration, which ADR-0009 §4
> deleted, and says why that is not a reversal.

## Context

Every run assembles a system prompt from the same fixed text. That text is
right about how Ortha works and necessarily silent about how _your_ team
works — house style, the checklist before a page is published, which fields
matter in a release note. So people paste those instructions into the message
box, once per question, and the copy drifts across whoever remembers to paste
it.

The obvious fix is a place to write them down. Two constraints shape what that
place can be:

- **Instruction text is a prompt, not content.** Whoever writes a skill writes
  part of the system prompt for everyone in the workspace. That is a
  configuration privilege, and treating it as an editorial one would mean
  anybody who can write an article can change how the assistant behaves for
  every colleague.
- **The run engine fences every tool result.** `fenceUntrusted` wraps a tool's
  output and tells the model, in as many words, that what follows is data and
  never instructions (ADR-0005 §8). That invariant is what makes reading
  attacker-influenceable entry bodies safe, and it is exactly wrong for a skill,
  whose whole point is to _be_ instructions.

## Decision

**A skill is a named instruction packet with a description of when it applies.
Two sources produce them, one catalogue serves them, and they reach the model
only through the system prompt.**

1. **Two sources, one catalogue.** An operator declares skills in code
   (`CopilotPlugin({ skills })`), validated at construction like the provider
   list and available in every workspace. An admin authors skills in the CMS
   (`copilot_skills`), scoped to one workspace. `mergeSkills` combines them with
   **code winning a name collision**; the write routes refuse a colliding name
   up front, so reaching the merge means a deploy took a name over, not a
   request.

2. **Three channels, all of them the system prompt.** A skill marked `always` is
   in force for every run in its workspace; a skill the person attaches in the
   composer is in force for that turn; every other enabled skill appears as
   `name — description` only, so the model can recommend one it was not given.
   Bodies are injected between the SECURITY and ANSWERING sections — after the
   rules a skill must not override, before the style rules it should refine.

3. **No tool delivers a skill.** Progressive disclosure through a
   `copilot_skill_read` tool is the obvious design and is rejected: it would
   mean either carving an exception into `fenceUntrusted` for one tool name, or
   handing the model instructions labelled as inert data and relying on it to
   disobey the label. Automatic selection, if we want it, becomes a
   **server-side pre-pass** that matches the message against descriptions before
   the first model call — deterministic, auditable, and no new trust channel.

4. **The client sends names, never text.** `CreateRunDto.skills` is
   `[{ name }]`, capped at three, resolved against the workspace catalogue. A
   request that could carry instructions would let anyone holding `copilot:use`
   write their own system prompt. An always-on skill is never in the request at
   all: the server applies it regardless, so naming it would be the client
   asserting a decision that is not its own.

5. **Authoring needs `copilot:skills:manage`, granted to admin only.** Using a
   skill needs nothing beyond `copilot:use`, which every role holds.

6. **A skill cannot widen authority, and is told so.** The capability profile is
   resolved from the caller's own role before any skill text is read and
   re-checked per tool call. The SKILLS IN FORCE section states the rule to the
   model as well, so it does not spend a turn trying.

7. **Every turn records what it ran under.** `copilot_messages.skills` holds a
   name/title/source snapshot, and the transcript renders it as chips. A person
   reading a thread back is otherwise unable to discover that an answer was
   written under instructions they never saw.

## Consequences

**Easier:**

- House style stops being something people paste. It is written once, visible in
  the composer, and recorded on every turn it shaped.
- The operator and the workspace get the same feature through the path each
  already uses — git for one, the admin for the other — with one merge rule
  between them rather than two subsystems.
- A skill is cheap when unused: one line of description per enabled skill, and a
  body only when it is actually in force.

**Harder / the cost we accept:**

- **This is per-workspace copilot configuration, which ADR-0009 deleted.** That
  record removed a screen deciding _what the copilot was allowed to do_, on the
  grounds that the caller's role already answers it. This one adds a screen
  deciding _how it writes_, which no permission can express. The distinction is
  the whole justification, and it has to hold in the code as well as in this
  paragraph: the day a skill can grant a tool, ADR-0009's argument is undone.
- **A skill body is context budget**, spent before the conversation and the tool
  results. Hence the caps — 8 000 characters per body, three attached skills per
  turn — and hence descriptions being bounded at 240 characters, since every
  enabled skill pays that on every run.
- **An admin can make the assistant worse for everybody**, quietly, with one
  always-on skill. There is no review step and no versioning: the transcript
  snapshots the _name_, not the body a turn actually ran with. Acceptable
  because the permission is admin-only and the edit is one row an admin can
  undo; not acceptable indefinitely if skills start changing often.
- **The model cannot load a skill it decides it needs.** It can name one and ask
  the person to attach it. That is a real limitation of choosing the prompt
  channel, and the pre-pass in §3 is the way out when it starts to bite.
- **A name is an interface.** Renaming a skill un-attaches it from anyone
  holding it staged, which is why the form stops deriving the identifier from
  the title the moment a skill exists.

**What this rules out:** delivering instruction text through a tool result, and
any skill field that narrows or widens the offered tool set. A `allowedTools`
on a skill was considered and deferred for exactly that reason — narrowing is
safe in itself, but a second authority mechanism beside the capability profile
is how the two drift.

## Alternatives considered

- **A `copilot_skill_read` tool** (progressive disclosure, the way an agent
  harness usually does it). Rejected on the fencing argument above. It is the
  design to revisit if the prompt channel proves too coarse, and the price of
  revisiting it is an explicit "this tool's output is instructions" flag on
  `ToolDefinition` — a concept the shared registry does not have and should not
  gain casually.
- **Skills as a content type.** Tempting: the CMS already has authoring,
  revisions and workspace scoping, and it would have cost almost no new code.
  Rejected because it puts prompt text behind `content:create` — a contributor
  permission — which is precisely the authority mistake this record is written
  to avoid. Revisions are the part worth stealing later.
- **Deployment-wide CMS skills** with a per-workspace enable flag. Fewer
  duplicates for a team running six similar workspaces. Rejected because a skill
  is guidance about a particular body of content, and the deployment-wide case
  is already served by code skills — which have the better story anyway, being
  reviewed in git.
- **Always-on only, with no per-turn attaching.** Simpler, and enough for house
  style. Rejected because the interesting skills are the situational ones — an
  SEO checklist, a migration guide — and forcing those on every run is how a
  prompt gets long enough to stop working.
- **Letting a workspace disable a code skill.** Cheap (an override row keyed by
  name) and useful. Deferred: it makes a code skill's behaviour no longer
  readable from the repo, which is the main thing code skills are for. Add it
  when somebody asks.
