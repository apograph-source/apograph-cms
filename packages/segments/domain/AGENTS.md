# `@orthacms/segments-domain`

The **segmentation kernel** — who may read a published entry, decided by one
pure function over two lists. No NestJS, no Drizzle, no React.

This is the reader-facing half of access. It is **not** RBAC and not
`workspace_content`: those answer who may _touch_ content and already exist.

| File                       | What lives there                                                     |
| -------------------------- | -------------------------------------------------------------------- |
| `segment.ts`               | A named set of reader tags, plus tag → id, plus where it is offered. |
| `entry-access.ts`          | The two lists, and `canRead`. The decision.                          |
| `segment-resolver.port.ts` | Where a reader's tags come from.                                     |
| `validation.ts`            | What a segment's fields may hold.                                    |

## The model, in full

A **segment** is a named set of reader tags — `Acme Corp` answering to `acme`
and `acme-legacy`. An **entry** names the segments that may read it and the
segments that may not. `canRead` applies three rules, in order:

1. **A deny wins.** A reader in any denied segment is out, however many allow
   lists they are also in. Reversed, "everyone in Europe except this customer"
   would be unsayable.
2. **An empty allow list means everyone.** Not nobody. The two look like the
   same emptiness and are opposite: an entry nobody has restricted is the state
   every entry starts in, and reading it as a closed door would black out a
   library the day the feature is switched on.
3. **Otherwise the reader must be in the allow list** — the anonymous reader
   included, who is in no segment and therefore sees only entries with an empty
   allow list.

That is the whole thing. There is no rule object, no inheritance, no ordering
between entries and nothing to resolve, so **what an editor sets on the entry is
what a reader gets** — which is what makes the admin's screen and the SQL
predicate two renderings of the same three lines rather than two models to keep
in step.

## Other rules worth keeping

**Where an audience is _offered_ is not a reader rule.** `isOfferedIn` answers
the editor's question — may I pick this here? — and `canRead` never consults it.
A stored decision means what its editor meant, so re-deciding it from a screen
about a segment's availability would change who can read published content with
nothing on either screen to say so. An empty `workspaceIds` means every
workspace, the same reading as an empty allow list and the state every segment
starts in.

**`sameAccess` is order-insensitive, and three surfaces depend on that.** The
lists are **sets** everywhere they matter — `canRead` asks about membership, the
stored arrays come back in insertion order, and a caller resending the same
audiences in a different order is asking for no change at all. The editor's
staging clears itself on it, the entry-write extension skips a write (and
therefore a permission check) on it, and the same extension decides from it
whether a record's whole locale group is already in step.

**Nothing outside `segment.ts` compares a raw tag.** Rules point at segment ids;
a tag is matched once, when a reader arrives. That indirection is what makes an
identifier renamed upstream one row edited here rather than a migration.

**The resolver fails closed.** An adapter that cannot reach its source returns
no tags rather than throwing. An empty set still reads everything unrestricted,
so an outage degrades to "public content only" instead of to an outage.

**The field rules live here, not in the form or the DTO.** `validateSegment` and
the four limits are read by the admin's dialog and by the server's
`class-validator` decorators alike. Two copies of a validation rule is two
copies to drift, and the way it surfaces is the worst one available: a form that
accepts what the API then refuses, with the refusal arriving as a 400 written
for a different audience.

## Commands

- `npx nx test @orthacms/segments-domain` — the decision table lives here.
- `npx nx typecheck @orthacms/segments-domain`
