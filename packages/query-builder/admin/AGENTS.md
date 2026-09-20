# @orthacms/query-builder-admin

Admin-side React component for visually composing filter trees against a
typed schema. Emits the JSON tree grammar consumed by `parseFilterTree`
in `@orthacms/utils-server`:
`?filter={"and":[{"field":"email","op":"ilike","value":"%@x"}]}`.
The state shape, wire format, and UI all round-trip OR + nested groups
end-to-end. Each group owns an AND/OR toggle and an Add group action.

## Package

- Name: `@orthacms/query-builder-admin`
- Import: `import { QueryBuilder, QueryBuilderPanel, type FilterField } from '@orthacms/query-builder-admin'`
- Pure UI library — depends only on `@orthacms/design-system`,
  `lucide-react`, `react-intl` (+ React peers). No router / data layer.

## Conventions

- Uses `type` for type contracts (not `interface`)
- All exported symbols must have JSDoc comments
- No `.js` extensions in TypeScript imports
- Types go in `src/lib/types/`; plain functions in `src/lib/utils/`
- Components go in `src/lib/components/{ComponentName}/index.tsx`
- i18n: each component co-locates its own `defineMessages` (no shared
  `messages.ts`), per the admin i18n convention
- Always import types with the `type` keyword

## Key exports

- `QueryBuilder` — headless controlled component over a `FilterTree`
- `QueryBuilderDrawer` — drawer wrapper owning open state, a staged
  draft, JSON preview, and the Apply/Reset footer; consumer passes a
  `trigger`. **No consumer in this repo** — every list page mounts the panel
  instead. Kept because it is published API, but nothing exercises it: an
  in-repo change to it is unverified by the e2e suite.
- `QueryBuilderPanel` — the **inline** surface every list page mounts, and the
  alternative to the drawer: a full-width accordion the consumer mounts between
  a toolbar and a table. The consumer owns the toggle button + `open` state; the
  panel owns the staged draft, JSON preview, and Apply/Reset footer. **Apply
  does not collapse it** — the URL and table update while the builder stays up
  for further edits; the toggle and Esc are what close it (Esc hands focus back
  to the toggle named by `labelledBy`). It animates its height
  (`grid-template-rows 0fr → 1fr`, ~150ms, reduced-motion-aware), caps the rules
  list and scrolls it internally, and is a `role="region"` labelled by the
  toggle (used by **members**, the **activity log**, the **content records**
  page, and the alarms rule editor). No portal container is needed — an inline
  panel isn't scroll-locked.
  On open it moves focus to the first condition's field cell — with
  **`preventScroll`**, which is not optional. That focus lands while the height
  is still animating, so a plain `focus()` makes the browser scroll the
  `overflow-hidden` wrapper (to ~85px) to reveal a control that was about to be
  visible anyway; the scroll is then clamped back to 0 as the row grows, sliding
  every control in the panel for a few hundred milliseconds _after_ the
  transition ends. A press during that slide is dropped in silence — `mousedown`
  on the button, `mouseup` elsewhere, `click` on their common ancestor.
  Takes `fieldsPending` / `fieldsError` / `onRetryFields` for a consumer whose
  `fields` are **fetched**: it renders a loading or error state in place of the
  builder and disables Apply. Required, not optional polish — the Apply gate
  rejects every rule whose field it can't resolve, so without the definitions
  Apply can never commit and an empty picker reads as a dead button. Reset
  stays enabled throughout (clearing the applied filter needs no definitions).
- `QueryBuilderSummary` — the collapsed resting summary: one removable chip
  per applied condition ("Author · Email contains @lilly ×") plus "Clear
  all"; removing a chip re-commits the narrowed tree at once. An **enum** rule's
  value is rendered through the field's declared members, because the wire value
  can be an opaque id and the chip is the only reading of a rule once the panel
  has collapsed — a plugin's virtual field makes that unmissable
  (`@orthacms/segments-admin` filters by a segment's uuid, so an unresolved chip
  read "Can be seen by is one of d19a552b-…"). An unknown member falls back to
  the raw value: a saved view can outlive the option it names, and a chip showing
  nothing would read as a filter that is not applied.
- `FilterField`, `FieldType`, `FilterEnumValue` — schema types the
  consumer declares (a static mirror of the BE `FilterSchema`). A
  `FilterField.id` may be a **dotted relation path** (`author.name`); its
  optional `group` (a `MessageDescriptor[]` breadcrumb) buckets it in the
  picker, and `relationTarget` marks a relation's `id` field so the value
  editor becomes a record picker.
    - **`group` means two things, and the `id` is what tells them apart.** On a
      dotted id it labels the relations the path walks. On a **flat** id it
      names a plain **category** — a heading in the picker with no traversal
      behind it, for fields that belong together but share no path: the virtual
      fields a plugin contributes (`@orthacms/segments-admin`'s Segmentation
      group). That is one field answering one question — "under what heading
      does this belong" — rather than a second `category` prop meaning the same
      thing, which the search breadcrumb would then have to read both of.
    - A flat field with no `group` stays a root scalar, which is every field the
      server derives from the type itself.
    - **`operators` decides the order, and therefore the default.** Picking a
      field resets its rule to `opsForField(field)[0]`, and `opsForField`
      narrows the field's declared list by what the type admits — not the other
      way round, which would ignore the order the field author wrote.
      `OPS_FOR_TYPE` orders for the general case (`equals` first, what a scalar
      column is usually asked); a field that declares its own list knows better,
      as segments' audience fields do in leading with `is one of`.
- `RelationValueEditor`, `RelationValueEditorProps` — the record-picker
  editor a consumer injects via `QueryBuilder`/`QueryBuilderDrawer`'s
  `renderRelationValue` (this package holds no data layer). It must be
  rendered as an element (`renderRelationValue={(p) => <Picker {...p} />}`)
  so its hooks get their own component scope, not the rule cell's.
- `FilterTree`, `FilterGroup`, `FilterRule`, `OpId`, `RuleValue` — tree types
- `treeToJsonFilter(tree, now?, options?)` — serialise tree → JSON string for
  `?filter=`. `options.relativeDates` keeps a `within_last` rule relative
  instead of resolving it to a cutoff: **pass it whenever the filter is going to
  be stored and replayed**, leave it off whenever it is going into a URL. The
  default is right for a deep link (the sender and the receiver see the same
  rows) and silently wrong for a saved filter, which would freeze its window on
  the day it was written and look entirely normal doing so.
- `jsonFilterToTree(params)` — inverse; reads `params.get('filter')`
- `countRules(tree)` — leaf count for a "Filters (N)" badge
- `treeHasInvalidRules` / `validateRule` — the Apply gate

## Wire grammar

Each leaf serialises to `{ field, op, value }`; groups to `{ and: [...] }` /
`{ or: [...] }`. UI ops map to BE operators:

| UI op                   | Wire op                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `equals` / `not_equals` | `eq` / `ne`                                                                                                 |
| `contains`              | `ilike`, value wrapped in `%v%`                                                                             |
| `is_one_of`             | `in` (value stays an array)                                                                                 |
| `is_empty`              | `null`, value `true`                                                                                        |
| `between`               | small `and` group of `gte` + `lte`                                                                          |
| `gt`/`gte`/`lt`/`lte`   | matching wire op                                                                                            |
| `within_last`           | `gte` with resolved ISO cutoff, **or** `within_last` with `{n,unit}` when the caller passes `relativeDates` |

Incomplete rules and empty groups are pruned at serialise time, so the
wire payload is always well-formed even while the drawer holds drafts.

**The reverse map is wider than the forward one, on purpose.** The builder
never writes `like` — its `contains` is `ilike` — but `parseFilterTree` accepts
`like` on every text field, and the list pages send the **raw** `?filter=` to
the API. A link carrying `like` therefore filtered the table while the builder
above it showed no chip at all, and the next Apply re-serialised the tree
without it and quietly widened the filter. So `WIRE_TO_UI` maps `like` back to
`contains`: it returns as `ilike`, a visible widening of one operator's
case-sensitivity, which is the same lossy-but-preferred rehydration this file
already makes for `gte`+`lte` → `between`.

The `FieldPicker` is a **relation-aware** field selector. At rest the trigger
shows the selected path as chips — relation segments as neutral chips, the
leaf as a solid chip ("Author · Email") — or a muted "Field" placeholder;
clicking or Enter opens the picker. The popover is a padded `Popover` + a
plain `Input` over one `overflow-y-auto` list (the records column-picker
pattern, **not** cmdk, so the wheel scrolls and the border stays clean). Idle,
it groups **Fields** (the collection's own scalars, first), then any **named
categories** (a plugin's flat virtual fields — the collection's own, so above
Relations; not what a reader scanning for a column of their type is after, so
below Fields), then **Relations**
(collapsed; expanding one reveals its fields under a "<Relation> fields"
sub-header plus its own nested relations, recursively). Typing flattens every
reachable field into one searchable list (token-AND over breadcrumb + leaf +
path); each field carries an `aria-hidden` type tag. Arrow keys move, Enter
selects a field or toggles a relation, Esc closes. The tree is rebuilt from
the flat `FilterField[]` by `utils/fieldTree` (`buildFieldTree` — the dotted
`id` segments name the relations, the aligned `group` breadcrumb names their
labels; the server already guards relation cycles). The trigger stays
`role="combobox"` and field rows `role="option"` (leaf label as the accessible
name), so the existing e2e selectors keep working. Selecting a relation's own
`id` field yields a record-picker value editor; a rule always keeps a field
(our model has no field-less rule), so there is no destructive clear — the
cell re-opens the picker to change the field.

**The picker's listbox is a real listbox.** Every _navigable_ row is an
`option` — including a relation row, which carries `aria-expanded` instead of
a value (a listbox admits no other interactive child). Group headings are
`role="presentation"`, so they don't sit in the tree as invalid children.
Focus never leaves the search box: it owns `aria-controls` + a live
`aria-activedescendant`, and rows are `tabIndex={-1}`. Both halves matter —
an arrow-key highlight with no `aria-activedescendant` is a purely visual
state assistive tech never hears, and options reachable only by Tab would
announce a position the keyboard can't act on. The same pattern is required
of any injected `renderRelationValue` editor (see `RelationValuePicker` in
content-admin) and of the locale switcher.

**Unknown fields.** `RuleRow` resolves its field by id with **no**
`?? fields[0]` fallback. Substituting an unrelated field would drive the
operator list and the inline validation off the wrong type while the rule
still carried the stale path — the row would look valid while the Apply gate
(which also resolves by id) silently refused to commit. Instead the rule
reports `RULE_VALIDATION.UnknownField`, unconditionally (it is a broken rule,
not an unfinished draft), and the field cell stays rendered so re-picking
fixes it.

**Portaling inside scroll-locked containers.** A `Popover` portals to
`document.body` by default, but the records filter mounts in a vaul
`QueryBuilderDrawer` (and the relation picker's inline builder in a Radix
`Dialog`) — both scroll-lock the page via react-remove-scroll, which blocks
mouse-wheel scrolling on anything **outside** their subtree, so a
body-portaled popover's list only drags, never wheels. `QueryBuilder` takes
a `portalContainer` prop and publishes it through `PortalContainerContext`;
the `FieldPicker` (and the consumer's injected relation value editor, via the
exported `usePortalContainer`) portal their `PopoverContent` into it. The
`QueryBuilderDrawer` wires its own element automatically; a consumer mounting
the bare `QueryBuilder` inside a dialog passes the dialog element as
`portalContainer`.

## Deferred

Compound-string fallback, SQL preview tab. (FK value editors now ship via
the injected `renderRelationValue` seam.)

## Commands

- `npx nx typecheck @orthacms/query-builder-admin`
- `npx nx test @orthacms/query-builder-admin` — the unit specs. Component
  behaviour belongs in `admin-e2e`, which drives a real browser; what lives here
  is what a browser cannot reach cheaply — `utils/fieldTree` (the pure tree the
  picker is built from, whose whole job is deciding which of three buckets a
  field belongs in), `utils/operators`, and the two halves of the wire format.
  The serialiser specs exist for the parts a browser genuinely cannot watch: the
  `relativeDates` argument, which is the only thing separating a link's frozen
  cut-off from a stored rule's sliding window, and the `throw` that catches an
  operator added with no `UI_TO_WIRE` entry and no branch.
