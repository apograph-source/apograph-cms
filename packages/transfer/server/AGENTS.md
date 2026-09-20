# `@orthacms/transfer-server`

The export/import **plugin**. Governed by the `server-plugin` skill; what
follows is what is specific to this one.

Owns **no tables and no migrations**. A transfer reads and writes content that
already exists; the only thing it adds is two audit events, which ride the
shared outbox.

| Folder     | What lives there                                                       |
| ---------- | ---------------------------------------------------------------------- |
| `archive/` | The hand-rolled ZIP writer and reader, plus CRC-32.                    |
| `schema/`  | Registry → kernel schema, and the one place identity fields are chosen.|
| `export/`  | The graph walk, the serializer glue, the routes.                       |
| `import/`  | The upload reader, the two-phase pipeline, the media path.             |

## The rules that matter here

**Every write goes through `EntryWriterService`.** Not "mostly" — every one.
That service is where field validation, the workspace scope, relation-target
checks, the same-locale rule, the media-asset check, revisions, the outbox and
the bound i18n extension live. An import that reached for a content table
directly would be a supported way to write rows none of those rules ever saw.

**The walk stops at one hop, and the references do not.** Depth-1 records still
get resolvable `$ref`s, filled by a key-only projection over the depth-2 rows.
A reference carrying only a foreign row id is unresolvable anywhere else, which
is the whole problem natural keys exist to solve.

**Depth decides which policy governs a record, and there are two.** The
`ConflictPolicy` answers "this record is already here" for the records the
caller selected; the `RelationPolicy` answers it for the depth-1 records that
came along because something pointed at them. They are separate because the
answers usually differ: duplicating an article is a reasonable thing to ask for,
and duplicating its author because the article was duplicated is not. `link` is
the default and writes nothing to a matched related record — it exists so the
link can be made, not so the row can be rewritten.

**A record is matched two ways, in this order.** The natural key first, because
it is the identity that means something on another installation. The **source
row id** second, and only when the key found nothing: a `$id` that names a live
row of this type in this workspace is not a guess, it is the row the document
was written from. That fallback is what lets a type with no derivable identity
field — a category with one optional `name` resolves none — be linked to instead
of copied on every import, and it is why `matchAll` runs a second, cheap query
per type. Both sides of the key match read `identityFor`, the manifest's copy:
deriving it locally on one side and reading the manifest on the other is how a
record that exists gets created anyway.

**Locale handling reads the envelope, never the semantics.** `locale` and
`locale_group_id` are columns `content/server` defines for any `i18n: true`
type, so the walk asks "the other rows of this record" generically. On import
they are passed to `EntryWriterService` and the bound i18n extension validates
them. **This package must not depend on `@orthacms/i18n-server`.**

**The archive reader is the security boundary.** Read `archive/zip-reader.ts`
before touching it. The order of the checks is the defence: the central
directory first, so entry count, per-entry size, total size and compression
ratio are all refused *before* anything is inflated. Paths that climb out are
rejected, never sanitised.

**Storage cannot join the transaction.** A failed import deletes the blobs it
wrote. That bookkeeping is per-run and caller-owned (`ImportMediaRun`) — putting
it on the singleton service would let two concurrent imports roll back each
other's files.

**Nothing in an uploaded file names a workspace.** The manifest carries the
source workspace and the importer never reads it; the request's workspace is
stamped on every write.

## OpenAPI (`src/lib/docs/`)

`TransferPlugin` contributes a `docs.decorate` pass. The scanner could describe
none of these five operations: three answer framework-free `interface`s from
`@orthacms/transfer-domain`, and the two downloads write through `@Res()`, which
erases the return type entirely.

Three things about it are worth knowing before changing it:

- **The export offers four content types, `application/zip` among them.** The
  response's type is chosen from the request body's `format`, and `csv` is
  additionally promoted to a ZIP of one CSV per type whenever the export reaches
  more than one — which any `depth.relations` export does. Measured against a
  live server: the same `format: "csv"` request answers `text/csv` with
  relations off and `application/zip` with them on. The set comes from
  `TRANSFER_FORMAT_CAPABILITIES`, so a new format lands in the document with no
  edit here.
- **The apply route is described with the preview's shape.** Its declared return
  type is the narrower `ImportResult`, but both routes return whatever the one
  pipeline produced, so `version` and `hasChanges` are on the wire either way —
  verified live. Describing the type instead of the API would drop two fields a
  consumer can rely on.
- **The `typeName` parameter is not touched here.** These routes are mounted
  under content's `/content/{typeName}` namespace and content's own pass writes
  the registered-name enum onto them; this plugin cannot see the registry at
  decorate time, and a second writer would be a second thing to keep in step.
