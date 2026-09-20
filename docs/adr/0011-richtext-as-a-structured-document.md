# 0011 — Rich text is a structured document, not an opaque string

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Engineering

## Context

A `richtext` value was an **HTML string** in a `text` column. The kernel
(`@orthacms/content-domain`) — the one place both runtimes agree on what a
value *is* — validated it with `typeof === 'string'` plus `minLength` /
`maxLength` / `pattern`, and the admin editor produced HTML with `getHTML()`.

That made a body's semantics **unmodelled**, and therefore uncheckable. This
validated clean:

```ts
validateFieldValue('body', { type: 'richtext', required: true },
  '<h4>Intro</h4><h1>Title</h1><table><tr><td>a</td></tr></table>')
// → []
```

A skipped heading level, an inverted outline, and a table whose cells no header
governs are all things a screen reader user meets as a broken document, and the
platform could not say any of them was wrong — WCAG **1.3.1** (Info and
Relationships), **2.4.6** (Headings and Labels), and Section 508 **504.2**,
which asks whether an authoring tool *enables* the production of conformant
content.

Two further consequences of the same category error:

- **`maxLength` counted markup.** Bolding a word spent `<strong></strong>` of
  the author's budget, so the rule promised something other than what it did.
- **No language of parts.** Nothing in the field vocabulary could say that a
  quoted passage inside an English body is French (**3.1.2**). The platform
  localises whole entries, which settles the *page's* language and nothing
  smaller. A `lang` an author typed as raw HTML was neither validated nor
  guaranteed to survive an edit, which is the **504.2.1** preservation question.

Reported as [ORT-84](https://linear.app/ortha-source/issue/ORT-84), spun out of
the `content-domain` QA pass.

## Decision

**We model a rich-text value as a structured document** — the
ProseMirror/TipTap node tree the admin editor already produces — stored in a
`jsonb` column, and we put the document, its readings and its structural rules
in the shared kernel so both runtimes apply exactly one definition.

1. **The kernel owns the model** (`content-domain/lib/richtext/`): the node
   vocabulary and guards, `richTextPlainText` (the body's **text**, which is
   what a length rule counts and a `pattern` matches), `isEmptyRichText`, an
   HTML serializer, and `inspectRichText` — the structural rules for heading
   continuity, table headers, link text and `lang` well-formedness.
2. **The vocabulary is open.** `RICH_TEXT_NODE` names what the kernel *reasons
   about*, not what a document may contain, so an editor extension (a callout, a
   column layout, an embed) rides through untouched. Closing it would make the
   kernel the gatekeeper of every plugin's extension set — the coupling
   [ADR-0003](0003-tactical-ddd-inside-plugins.md) keeps out of there.
3. **Errors block, warnings inform.** A finding that is wrong however the
   document is read (a skipped level, a header-less table, an empty link, a
   `lang` no user agent can parse) fails validation. A judgement about phrasing
   ("click here" as link text) is surfaced by the editor and never blocks a
   save. A field opts out entirely with `validation: { structure: 'off' }`.
4. **The editor shows the whole list while the author is writing.** 504.2 asks
   that the tool *enable* conformance; a rule an author only meets as a rejected
   save enables nothing.
5. **Language of parts is expressible and preserved.** A node carries a `lang`
   attribute and an inline run carries a `language` mark; the editor writes them
   through a toolbar control, the serializer keeps them, and a field may declare
   its own `lang` for the case where the whole value is in another language.
6. **A legacy HTML string stays a valid value.** The migration is
   `USING to_jsonb(col)` — an existing body becomes a JSON *string* in the same
   column. Nothing is parsed, so nothing can be lost. Such a value still reads,
   validates (the kernel parses it for analysis) and renders; the editor
   rewrites it as a document the first time the record is saved, so content
   upgrades as it is edited.

## Consequences

**Easier.** The semantics are data, so they can be checked, and the same check
runs in the editor, at save, and at publish. `maxLength` now measures prose. A
consumer of the public API or GraphQL receives a tree it can render however it
likes, rather than markup it must sanitize. Adding a rule is adding a function
to `inspectRichText`, and both runtimes get it at once.

**Harder.** A `richtext` value is no longer a string, and every reader of one
has to accept both shapes for as long as un-re-saved bodies exist —
`richTextPlainText` / `asRichTextDocument` are how. `richtext` is no longer
**filterable or sortable**: `equals` / `starts with` over a document would
compare serializations of a tree rather than prose. Free-text `?search=` still
reaches a body by casting the column to text, which searches the serialized
tree — good enough to find words, and imprecise enough that a stored, indexed
text projection is the right answer when search is next revisited. On the wire,
GraphQL's field type moves from `String` to `JSON`, which is a breaking change
for a consumer that assumed a string.

**Ruled out.** Bodies are not upgraded by a batch migration. Converting HTML to
a document means deciding what every unknown tag meant, and doing that in SQL —
or in a one-shot script whose parse is not the editor's — is how content gets
silently rewritten. The editor's own schema is the only parser that knows what
this deployment can represent, so it is the only one allowed to commit a
conversion.

## Alternatives considered

- **Keep the string, add an HTML-parsing validator.** No storage change and no
  wire change, but the checkable thing would still be markup: a rule would run
  against whatever a regex or a server-side DOM made of the string, and the
  editor, the server and any other consumer would each have their own idea of
  what the body contained. `maxLength` would still count tags, and a `lang`
  would still have no modelled home.
- **A batch migration that parses every body to a document.** Tempting, since it
  would leave one shape in the database. Rejected for the reason above: the
  parse would have to happen outside the editor's schema, and a lossy rewrite of
  content nobody asked to change is worse than a mixed-shape column that
  converges.
- **A new field type (`document`) beside `richtext`.** It would leave existing
  schemas untouched, at the cost of two long-form field types forever, two sets
  of rules, and a migration every content model has to perform by hand. The
  finding is that `richtext` is modelled wrongly, not that a second kind of body
  is missing.
- **Enforcing every structural rule.** Turning "click here" into a save failure
  makes a heuristic into a gate, and a gate an author cannot satisfy without
  rewording a sentence they may have meant. Warnings carry it instead.
