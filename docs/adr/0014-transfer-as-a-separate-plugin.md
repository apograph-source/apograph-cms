# 14. Export and import as a separate plugin, one hop deep

Date: 2026-08-24

## Status

Accepted

## Context

Editors need to get content out of the CMS and back in: to hand a translator a
spreadsheet, to move a section between installations, to keep an off-site copy,
to seed a staging environment from production.

"Export a record" sounds like one decision and is actually three.

**How far does it reach?** A record on its own is rarely useful. An article
without its author, its tags and its hero image imports somewhere else as an
article with empty fields. So an export has to travel — and the moment it
travels, it has to be told when to stop. Content graphs are almost always
connected: follow relations recursively from one article and you reliably reach
most of the library, without warning and without a way for the person who
clicked to know that was going to happen.

**What does a record even mean somewhere else?** A row id is a fact about one
database. Carried elsewhere it names nothing, so an import keyed on ids can only
ever create. Run the same file twice and you have two copies of everything.

**Where does the code live?** Export and import touch content, relations, media
bytes and locales. Putting them inside `content/server` would grow that package
a storage dependency and an archive format; spreading them across the plugins
they touch would put the depth rule in four places.

## Decision

### A separate plugin, adapting the existing surfaces

`@orthacms/transfer-{domain,server,admin}` — a protocol adapter over content,
the same role `content/graphql` plays for GraphQL
([ADR-0008](0008-graphql-as-a-protocol-adapter.md)). It reads through
`EntriesService` / `EntryWriterService` and the content registry, and writes
**only** through `EntryWriterService`. Nothing in the system calls into a
transfer, so the dependency arrow points one way and the package graph stays
acyclic: `transfer → content`, `transfer → media` (optional).

Writing through the ordinary writer is the load-bearing part. It is where field
validation, the workspace scope, relation-target checks, the same-locale rule,
the media-asset check, revisions, the outbox and the bound i18n extension all
live. An importer that reached for the table directly would be a supported way
to write rows that none of those rules ever saw.

### Depth is exactly one hop

- **Depth 0** — the records the caller selected, plus their locale siblings.
- **Depth 1** — every record reached by following one relation, exported in
  full.
- **Depth 2** — not exported. The depth-1 records' references to them survive as
  references, carrying a natural key so an import can link them to whatever the
  target installation already has.

Four independent toggles (`relations`, `media`, `locales`, `relationLocales`)
decide what of that is actually reached for. `relationLocales` is **off** by
default: it multiplies the payload by the locale count on top of the relation
count.

A preview endpoint runs the same walk and reports the counts, so the export
dialog can show the cost of a toggle before it is paid.

### Identity travels as a natural key

Every record and every reference carries `$key` — the values of the fields that
identify a record of its type. Fields are named per type in plugin config; left
out, they are derived (a field *named* like an identifier, then the first
required text field) and the choice is written into every export's manifest, so
an import matches on what the export keyed on rather than re-deriving against a
schema that may have drifted.

A **localized** field is a candidate, and the locale is folded into the match. A
transfer record is one *row*: the English and German versions of an article
travel as two records and are stitched back into one by their locale group.
Excluding localized fields instead would leave a fully-localized type — the
normal shape — with no key at all, so every import of it would duplicate every
row.

### Import is one pipeline, run twice

A dry run produces per-record verdicts and writes nothing; the apply pass is the
same code with a flag flipped. Records are written values-first and links-second
so cycles and mutual references resolve without a topological sort. The whole
apply runs in one transaction.

`content:export` and `content:import` are new permission keys, and import
additionally re-checks the caller's own `content:create` / `content:update` per
record — so an import can never exceed what its caller could do by hand.

## Consequences

**Localization needed no new port.** `locale` and `locale_group_id` are envelope
columns `content/server` defines itself for any `i18n: true` type, so the walk
reads "the other rows of this record" generically and never learns what a locale
means. On import the locale and group id are handed to `EntryWriterService` and
the bound i18n extension validates them. This plugin does not depend on
`i18n/server` at all.

**CSV is lossy and says so.** A flat table cannot hold a rich-text document or
an ordered link list. Formats sit behind a port with a capability table the UI
and the server both read, so the dialog cannot offer a promise the format cannot
keep — and media cells are deliberately not reconstructed on the way back, since
a filename in a spreadsheet is not a file.

**The archive is ours.** The ZIP container is hand-rolled on `node:zlib` rather
than taken from npm, because reading an untrusted archive is the one place a
stranger's bytes arrive and the order of the checks is the defence: the central
directory is read first, so entry count, per-entry size, total size and
compression ratio are all refused before anything is inflated.

**Blobs cannot join the transaction.** A failed import deletes the assets it
uploaded; the bookkeeping is per-run rather than held on the singleton service,
where two concurrent imports would share it.

**A big export is still a synchronous request**, bounded by configurable
ceilings that answer `413` with a sentence naming the limit. Asynchronous jobs
(a `transfer_jobs` table, progress, a link to a finished archive) are a later
step this design leaves room for and does not take.
