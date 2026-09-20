# Query Builder

_Package · packages/query-builder/admin_

**The visual filter-tree builder and the grammar it writes**

Query Builder is not a plugin but a **pure UI library**: it has no database tables, no HTTP routes and no data layer. It does exactly one thing — turns a **typed field schema** into a screen where an editor assembles a condition with the mouse, and serialises what was assembled into the JSON grammar that `parseFilterTree` parses on the server. The reverse transformation is its job too: a `?filter=` from the address bar is lifted back into an editable tree in full, ORs and nested groups included.

- **14** UI operators
- **12** wire operators
- **6** field types
- **12** components
- **6** consuming packages
- **5** mount points
- **11** validation codes
- **0** tables and routes

## Contents

- [01. Business description](#01-business-description)
- [02. Its place in the system and its consumers](#02-its-place-in-the-system-and-its-consumers)
- [03. The filter-tree grammar](#03-the-filter-tree-grammar)
- [04. Operators: three dictionaries and how they relate](#04-operators-three-dictionaries-and-how-they-relate)
- [05. The field schema and how the interface is built from it](#05-the-field-schema-and-how-the-interface-is-built-from-it)
- [06. The round trip: state ⇄ wire](#06-the-round-trip-state-wire)
- [07. The component's API](#07-the-components-api)
- [08. Step-by-step scenarios](#08-step-by-step-scenarios)
- [09. Limits and validation: client and server](#09-limits-and-validation-client-and-server)
- [10. Accessibility and the keyboard](#10-accessibility-and-the-keyboard)
- [11. Invariants](#11-invariants)
- [12. Testing checklist](#12-testing-checklist)
- [13. Boundaries of responsibility](#13-boundaries-of-responsibility)
- [14. Discrepancies between the code and the documentation](#14-discrepancies-between-the-code-and-the-documentation)

## 01. Business description

Lists in a CMS are long. A collection's entry registry, the activity log, the member list — all of them are tables where the answer to a working question (“which of Ivanov's articles have not been updated in 90 days and have no German translation?”) lies in three or four intersections at once. A search box answers one question in ten; everything else runs into either “export me a CSV” or a request to a developer.

### The problem it solves

- **A complex question without SQL.** The user assembles a condition out of ready-made blocks: a field, an operator, a value. AND/OR combinations and nested groups give full boolean logic, but not a single character of syntax has to be typed.
- **One language across the product.** The entry registry, the log, the members and the alarm rules use _one_ grammar and _one_ builder. Having learned filtering in one place, an editor can filter everywhere, and an engineer does not have to maintain a second query language.
- **A filter as a link.** The result lives in `?filter=`. Sending a colleague the address sends them exactly the slice you see yourself — rather than a description of how to reproduce it.
- **A filter as a rule.** The same tree, saved, becomes an alarm rule (“watch for entries that look like this”) or a saved view. An alarm rule is literally _the list filter's tree stored verbatim_, evaluated by the same engine, which is why alarms have no condition language of their own.
- **The impossibility of assembling a query the server will reject.** The operator list is narrowed by the field's type; a value is checked by the same rules the server's type coercion applies; the “Apply” button does not fire on a half-assembled rule. The error is caught in the interface rather than arriving from the API as “could not load the collection”.

### Who sees it

#### The content editor

Opens the panel under the registry's toolbar, types two or three conditions and presses “Apply”. The table below the panel is rebuilt and the conditions settle as removable chips. “Save as an alarm” is made out of the same state.

#### The administrator

Filters the activity log (“who did what to this entry in the last day”) and the member list (“every disabled contributor”). Both pages offer the same panel with the same behaviour.

#### The support engineer

Expands the “JSON preview” block, copies the payload and pastes it into a curl or a ticket. What the preview shows is exactly what will go on the wire.

> **The key idea**
>
> The package is a **controlled component with no data layer**. It requests nothing and goes nowhere: the field schema and the value editor for relations are _passed in from outside_. That is exactly why one and the same panel could be attached to four completely different screens, each with its own source of fields — a static array, an API response, or a plugin's contribution through a slot.

## 02. Its place in the system and its consumers

There is one package — `packages/query-builder/admin`, published as `@orthacms/query-builder-admin`. The group has no server half and none is intended: the grammar is parsed on the server by `parseFilterTree` from `@orthacms/utils-server`, and that is a _different_ package the builder knows nothing about — the only thing linking them is the JSON format.

### What depends on what

| Dependency              | Role                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| @orthacms/design-system | Button, Input, Select, Checkbox, Popover, Drawer, SegmentedControl, Alert, Spinner — everything visible is assembled from these |
| lucide-react            | The icons: Plus, X, Check, ChevronDown/Right, Copy                                                                              |
| react-intl              | Every label is a `MessageDescriptor`. Each component keeps its own `defineMessages` next to it                                  |
| react / react-dom       | Peer dependencies, ^19                                                                                                          |

No router, no TanStack Query, no `apiClient`. That is not asceticism but the condition of reuse: the package is mounted both inside a page and inside the modal dialog for picking a related entry, where there is no “current list” at all.

### Five mount points

| Where                                                                         | Which wrapper                              | Where the fields come from                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A collection's entry registry**<br>content-admin, `LoadedRecordsView`       | QueryBuilderPanel<br>+ QueryBuilderSummary | `useFilterFields(typeName)` — the `GET /content-schema/:name/filter-fields` response, plus the `RECORDS_FILTER_FIELDS_SLOT` slot's contributions |
| **The activity log**<br>activity-admin, `ActivityLogPage`                     | QueryBuilderPanel<br>+ QueryBuilderSummary | The static `ACTIVITY_FILTER_FIELDS` constant — 6 fields, mirroring the server's `ACTIVITY_FILTER_SCHEMA`                                         |
| **Members**<br>users-admin, `MembersPage`                                     | QueryBuilderDrawer                         | The static `MEMBERS_FILTER_FIELDS` constant — 5 fields, including the `role.key` relation                                                        |
| **The alarm rule editor**<br>alarms-admin, `AlarmRuleEditorPage`              | QueryBuilderPanel<br>+ QueryBuilderSummary | The same `useFilterFields` plus the same slot contributions — “a rule cannot say more than the list can”                                         |
| **The related-entry picker dialog**<br>content-admin, `RelationPickerFilters` | QueryBuilder<br>bare, inside a Collapsible | `useFilterFields` for the target type; the filter is applied at once, with no Apply                                                              |

### Who contributes fields without mounting the component

Two plugins extend the registry's filterable surface through the `RECORDS_FILTER_FIELDS_SLOT` slot. Their fields are **virtual**: there is no column behind them and the server answers them with a subquery, so they declare a narrowed operator list through `FilterField.operators`.

| Plugin         | Fields                               | Type                                  | Operators                            |
| -------------- | ------------------------------------ | ------------------------------------- | ------------------------------------ |
| i18n-admin     | `hasLocale` / `missingLocale`        | enum — the list of configured locales | equals, is_one_of                    |
| i18n-admin     | `localeCount`                        | number                                | equals, not_equals, gt, gte, lt, lte |
| segments-admin | `audienceAllowed` / `audienceDenied` | enum — the workspace's audience uuids | is_one_of, equals                    |
| segments-admin | `accessRestricted`                   | boolean                               | equals                               |

> **Why there is no negation**
>
> `is not` has been deliberately removed from the operator list of both the locale and the audience fields. Negation in these fields moves _inside_ the subquery: `hasLocale ne "de"` means “the translation group contains some locale other than German” — which a fully translated entry also satisfies. Absence is expressed by the neighbouring `missingLocale` field. The same goes for audiences: `audienceAllowed ne "acme"` reads as “not visible to Acme” but does not mean that.

## 03. The filter-tree grammar

The grammar is deliberately tiny. It has **two kinds of node** and nothing else: a group and a rule. Everything else is a combination of those two.

### The group node

An object with exactly **one** key — `and` or `or` — whose value is an array of child nodes. Children may be rules or other groups, intermixed and at any permitted depth.

```
{ "and": [ <node>, <node>, ... ] }
{ "or":  [ <node>, <node>, ... ] }
```

The server rejects a group that declares both keys at once (`FILTER_INVALID_NODE`), and a group with an empty array (also `FILTER_INVALID_NODE`) — an empty group is meaningless and, translated into SQL, would yield either “nothing” or “everything”.

### The rule node (a leaf)

An object with three keys: `field`, `op`, `value`.

```
{ "field": "author.name", "op": "ilike", "value": "%Ivan%" }
```

| Key   | What it is                                                                                                                                                                                                                                                          | The server's check                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| field | A non-empty string. It may be a **dotted path across relations** — `author.company.name`. The path is split on dots and walked segment by segment through the `FilterSchema`: every segment but the last must be a declared relation, and the last a declared field | `FILTER_UNKNOWN_FIELD`, `FILTER_UNKNOWN_RELATION`, `FILTER_DEPTH_EXCEEDED`, `FILTER_EMPTY_PATH`                                                      |
| op    | A non-empty string from the wire-operator dictionary                                                                                                                                                                                                                | `FILTER_UNKNOWN_OPERATOR` — no such operator at all; `FILTER_OPERATOR_NOT_ALLOWED` — the operator exists but the column's type does not answer to it |
| value | A scalar (string/number/boolean), an array for `in`/`nin`, a boolean for `null`, an `{n, unit}` object for `within_last`. **The grammar's only object-typed value is `within_last`**                                                                                | `FILTER_INVALID_VALUE`, `FILTER_EMPTY_IN_LIST`, `FILTER_MAX_IN_LIST_EXCEEDED`                                                                        |

> **Why a value is not coerced through String()**
>
> The server **rejects** a non-scalar value instead of coercing it to a string. The reason is that `String(v)` yields a plausible string that a comparison is then made against: `null` → `"null"`, a missing key → `"undefined"`, `{}` → `"[object Object]"`, `[1,2]` → `"1,2"`. Every such case would return a 200 with an empty result set, which the client reads as “no matches” rather than “a bad request” — the one silent refusal in a library that answers everything else with a 400.

### The root

The root may be either a group or a single rule — the server accepts both. The client, though, always holds a **group** in state: `jsonFilterToTree`, on meeting a single rule at the root, wraps it in an `and` group. An empty object `{}`, a missing parameter and an empty parameter all yield `null` — the caller simply adds no WHERE.

### Complete examples

#### A flat condition of two rules

“Active members with an @lilly address” — what the members page's `?filter=` will write:

```
{
  "and": [
    { "field": "status", "op": "eq",    "value": "active" },
    { "field": "email",  "op": "ilike", "value": "%@lilly%" }
  ]
}
```

#### An OR inside an AND — a nested group

“Entries whose author is Ivanov _or_ Petrov, and which have not been updated since 1 January”:

```
{
  "and": [
    {
      "or": [
        { "field": "author.name", "op": "eq", "value": "Ivanov" },
        { "field": "author.name", "op": "eq", "value": "Petrov" }
      ]
    },
    { "field": "updatedAt", "op": "lt", "value": "2026-01-01T00:00:00.000Z" }
  ]
}
```

The outer group is the root with its own AND/OR switch; the inner one is what appears from the “Add group” button and is drawn with a dashed border, its own switch and a “Delete group” cross.

#### A range: one rule in the UI, three nodes on the wire

The `between` operator has no wire representation of its own. It expands into a small `and` group of a `gte` and an `lte` on the same field:

```
{
  "and": [
    { "field": "createdAt", "op": "gte", "value": "2026-01-01T00:00:00.000Z" },
    { "field": "createdAt", "op": "lte", "value": "2026-02-01T00:00:00.000Z" }
  ]
}
```

> **The reverse transformation is lossy here**
>
> `jsonFilterToTree` folds an `and` group of exactly two `gte`+`lte` rules on one field back into a single `between` rule. There is no way to tell that apart from an honest group assembled by hand from two rules — their serialisation is byte-identical. The “between” reading was chosen as the more common and more editorial one. No semantics are lost in the process: the WHERE comes out identical, and the only difference is _which value editor_ the user will see after a reload.

#### A relative window

The grammar's only object value. Stored and computed on the database's side:

```
{ "field": "updatedAt", "op": "within_last", "value": { "n": 90, "unit": "days" } }
```

The units are only `minutes`, `hours` and `days`. In SQL this is `column >= now() - make_interval(days => 90)`: the cut-off is computed by Postgres at query time, not when the filter was written.

#### Emptiness

The `null` operator serves _two_ UI operators, differing only in its value:

```
{ "field": "summary", "op": "null", "value": true  }   // is empty      → IS NULL
{ "field": "summary", "op": "null", "value": false }   // is not empty  → IS NOT NULL
```

Both boolean literals and the strings `"true"`/`"false"` are accepted; everything else is a 400.

## 04. Operators: three dictionaries and how they relate

There is not one operator list but three, and confusing them is the main source of misunderstanding when reading the code.

#### UI operators — `OP`

14 of them. What the user sees in the dropdown. They live in `filter-tree.type.ts` and are never serialised in that form.

#### Wire operators — `WIRE_OP`

12 of them. What goes into the JSON. They live in `utils/wireOp.ts`. The client never writes a bare string — only through the mapping table.

#### Server-side — `FilterOperator`

13 of them: the same 12 plus the case-sensitive `like`, which the admin UI never produces.

### The full table

The “types” column is which `FieldType`s the operator is offered for by the picker at all (the `OPS_FOR_TYPE` table); a field may narrow that set with its own `operators`, but not widen it.

| UI operator  | Label                    | Field types                         | Wire                   | What it does and what it becomes in SQL                                                                                                                                                                |
| ------------ | ------------------------ | ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| equals       | equals                   | string, number, boolean, uuid, enum | eq                     | `col = $v`. Deliberately absent for dates — see the note below                                                                                                                                         |
| not_equals   | is not                   | string, number, uuid, enum          | ne                     | `col <> $v OR col IS NULL` — **the negation includes NULL**                                                                                                                                            |
| contains     | contains                 | string                              | ilike                  | The value is escaped (`\`, `%`, `_`) and wrapped in `%…%` → `col ILIKE '%v%'`                                                                                                                          |
| not_contains | does not contain         | string                              | nilike                 | The same escaping → `col NOT ILIKE '%v%' OR col IS NULL`                                                                                                                                               |
| is_one_of    | is one of                | string, number\*, uuid, enum        | in                     | The value stays an array → `col IN (...)`. An empty array is rejected by the server                                                                                                                    |
| not_one_of   | is none of               | string, uuid, enum                  | nin                    | `col NOT IN (...) OR col IS NULL`                                                                                                                                                                      |
| is_empty     | is empty                 | all six                             | null                   | The value `true` → `col IS NULL`. No value editor is rendered at all                                                                                                                                   |
| is_not_empty | is not empty             | all six                             | null                   | The value `false` → `col IS NOT NULL`                                                                                                                                                                  |
| gt           | greater than             | number, date                        | gt                     | `col > $v`                                                                                                                                                                                             |
| gte          | greater than or equal to | number, date                        | gte                    | `col >= $v`                                                                                                                                                                                            |
| lt           | less than                | number, date                        | lt                     | `col < $v`                                                                                                                                                                                             |
| lte          | less than or equal to    | number, date                        | lte                    | `col <= $v`                                                                                                                                                                                            |
| between      | between                  | number, date                        | — (composite)          | Expands into `{and:[gte, lte]}` on the same field. The value is a `{from, to}`                                                                                                                         |
| within_last  | within the last          | date                                | gte **or** within_last | By default it resolves to a concrete ISO cut-off and goes out as a `gte`; with the `relativeDates` flag it goes out as a `within_last` with an `{n, unit}` value → `col >= now() - make_interval(...)` |

\* `is_one_of` on numbers is permitted by the server's table, and the client's `OPS_FOR_TYPE` does not offer it: type `number`'s set is equals, not_equals, gt, gte, lt, lte, between, is_empty, is_not_empty.

> **Why dates have no equals**
>
> The date editor is an `<input type="datetime-local">`, that is, **minute precision**, while the column is a `timestamptz` with milliseconds. An `eq` would compare against an instant at second zero and would practically never match a single real row — a dead-end filter. Ranges (`between`, `gt/gte/lt/lte`, `within_last`) bound rather than pin an instant, so they remain.
>
> On the server `eq` on a date is nevertheless **permitted**: the server's `OPERATORS_BY_TYPE` table describes what a column is capable of, not what a particular editor offers. Through an API token or a hand-assembled URL, a legitimate `publishedAt eq <instant>` goes through.

> **The server's one real operator restriction**
>
> The server's table is wider than the client's in exactly one place, and that is the `~~` family: Postgres defines `like`/`ilike`/`nilike` only for text. So an `ilike` on a `date`, a `number`, a `boolean` or a `uuid` is rejected with the `FILTER_OPERATOR_NOT_ALLOWED` code. Before that check existed, such a rule reached the driver and came back as **a 500 behind a forwardable link**. The check runs _before_ value coercion, so that the error names the operator rather than a value the operator would not have accepted anyway.

### The mapping tables' asymmetry

The `UI_TO_WIRE` table holds **nine** entries, not fourteen. Five UI operators have no row in it and are handled by the serialiser directly, because they either expand into a composite form or require a value transformation:

- `contains` and `not_contains` — present in the table (`ilike`) or handled by a branch (`nilike`), but in both cases the value is escaped and wrapped in percent signs by hand;
- `is_one_of` / `not_one_of` — the value must stay an array;
- `is_empty` / `is_not_empty` — they share one wire operator and differ in the value;
- `between` — a group of two nodes;
- `within_last` — two different wire forms depending on where the filter is headed.

The reverse table, `WIRE_TO_UI`, is by contrast complete (11 entries): it must be able to read anything that could have been written. All three tables are read through `Object.hasOwn` rather than a bare index: an `op` arrives from a public, hand-editable URL, and `WIRE_TO_UI['constructor']` would return `Object` — a truthy value that would stop “an unknown operator” from being filtered out and turn it into a rule whose `op` is a function.

## 05. The field schema and how the interface is built from it

Everything the builder knows about the subject area arrives as one flat `FilterField[]` array. It contains no depth and no nesting — the hierarchy is _reconstructed_ from two of the record's fields.

### One field's description

| Property       | Required | Meaning                                                                                                                                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | yes      | The field's name on the wire. For a scalar column it is the name itself; for a field across a relation it is a **dotted path** (`author.name`). It must match a leaf the server's `FilterSchema` allowlists |
| label          | yes      | A `MessageDescriptor`. For display only, never serialised                                                                                                                                                   |
| type           | yes      | One of six: `string`, `number`, `boolean`, `uuid`, `date`, `enum`. It decides the operator set, the kind of value editor and the validation rules alike                                                     |
| enumValues     | for enum | An array of `{value, label}` pairs. The `value` goes on the wire, the `label` is rendered                                                                                                                   |
| operators      | no       | Narrows the operator set _within_ what the type permits. **And it sets the order, and therefore the default**                                                                                               |
| group          | no       | A `MessageDescriptor[]` — breadcrumbs. Its meaning depends on the `id`, see below                                                                                                                           |
| relationTarget | no       | The target type's name for a relation's `id` field (`author.id` → `'author'`). It swaps the uuid input for an inline entry picker                                                                           |

> **One group property, two readings — and the id tells them apart**
>
> On a **dotted** `id` the breadcrumbs name the relations the path travels through: `author.company.name` + `['Author','Company']` — the segments and the crumbs line up by index. On a **flat** `id` the first crumb names an ordinary _category_ — merely a heading in the picker, with no traversal behind it: that is how a plugin's virtual fields are grouped (segments' “Segmentation” section). This is one property answering one question — “under which heading does this sit” — rather than a second `category` property meaning the same thing, which a breadcrumb in search would then have to read alongside the first.
>
> A category is **single-level**: only the first crumb is read. Nesting here is the right of a relation, which has a path to prove it.

### Reconstructing the tree — `buildFieldTree`

The package's only function covered by unit tests (a browser does not reach it cheaply). One pass over the flat array sorts the fields into three baskets:

1. **Collection fields (`fields`)** — a flat `id` and no `group`. Everything the server derived from the type itself.
   _In the picker: the “Fields” section, first_
2. **Categories (`categories`)** — a flat `id` with a `group`. The basket's key is the heading message's `id`; the baskets' order is the order of first appearance, that is, the order in which contributions were registered rather than one invented by a sort.
   _In the picker: between “Fields” and “Relations”_
3. **Relations (`relations`)** — a dotted `id`. Every leading segment yields a `RelationNode` with an accumulating key (`author`, then `author.company`), and the label comes from the crumb with the same index. Recursively, to whatever depth the server chose to expose.
   _In the picker: “Relations”, collapsed_

The walk always terminates: relation cycles are cut off by the server — it does not unfold a path back into an ancestor type. If no label arrived for a segment, the node gets a fallback descriptor `qb.field.relation.<path>` with the segment's name as its text.

### The field picker

At rest the trigger shows the chosen path as **chips**: relation segments neutral, the leaf solid (“Author · Email”), or a muted “Field” placeholder. It opens on a click or Enter.

#### At rest

The sections in order: **Fields** — the type's own scalars; **named categories** — the plugins' virtual fields (they are collection fields, hence above relations, but not what a reader scanning the columns is looking for, hence below Fields); **Relations** — collapsed relations. An expanded relation shows a “\<Relation> fields” subheading, its own fields and its own nested relations, recursively. The indent is 8px plus 12px per level, set with padding so that the row's highlight spans the full width.

#### While typing in the search

The sections disappear and everything reachable is flattened into one list. A match is **token AND**: every word of the query must be found in the string “crumbs + leaf label + raw id”. So “aut ema” finds “Author · Email”, and so does `author.email`. Each row carries a small type tag marked `aria-hidden` (it is a visual hint, not part of the name).

The list is **a real listbox**. Every _navigable_ row is an `option`, the relation row included: it carries an `aria-expanded` instead of a value and is never `aria-selected` — a listbox permits no other interactive children. Section headings are marked `role="presentation"` so as not to become invalid nodes inside a listbox.

### The value editor

`ValueEditor` is one switch choosing a control by the “field type × operator” pair:

| Condition                                                                                                             | Control                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `is_empty` / `is_not_empty`                                                                                           | **Nothing.** The meaning is entirely in the operator                                                             |
| A `relationTarget` is present, `renderRelationValue` was passed, and the operator is an equality or a multi-value one | The consumer's inline entry picker. The value is always an array of ids; a single-value operator takes the first |
| `between`                                                                                                             | Two “From”/“To” inputs with an “and” separator. The input's type follows the field's type                        |
| `within_last`                                                                                                         | A number input (min 1, max `MAX_WITHIN_LAST` = 100,000) + a unit select                                          |
| enum + a multi-value operator                                                                                         | An `EnumMultiSelect` — a checkbox group over the declared members                                                |
| enum + a single-value operator                                                                                        | A `Select` over the declared members                                                                             |
| string/uuid + a multi-value operator                                                                                  | A `CsvValueInput` — free comma-separated entry                                                                   |
| boolean                                                                                                               | A `Select` of two items: true / false                                                                            |
| date                                                                                                                  | An `<input type="datetime-local">`, with the value converted to a full ISO instant and back                      |
| everything else                                                                                                       | An `<input>`, of type `number` or `text`                                                                         |

**Why an enum's value cannot be typed by hand.** Checkboxes and a select limit the choice to the declared members, so the array on the wire is always valid. Free-form CSV remains only where the set of values is open in principle — for strings and uuids — and that is exactly why its contents are validated element by element.

**Why CSV keeps a draft.** `CsvValueInput` holds the raw string in local state and never reads it back from `value.join(',')`: otherwise a trailing comma, a pause mid-word or a caret move would “collapse” right under the user's hands. The parsed array goes upwards on every keystroke (so the preview stays live), and normalisation (`a,,b` → `a,b`) happens on blur.

## 06. The round trip: state ⇄ wire

Two representations of one and the same condition. On the left is what React holds; on the right is what travels into a URL or a database.

#### The state: `FilterGroup`

```
type FilterGroup = {
  id: string;              // the React key
  combinator: 'and' | 'or';
  children: (FilterGroup | FilterRule)[];
}

type FilterRule = {
  id: string;              // the React key
  fieldId: string;         // = FilterField.id
  op: OpId;                // the UI operator
  value: RuleValue;
}
```

The `id` field is client-side, generated by `crypto.randomUUID()` and **never serialised**. `isRule` tells the nodes apart by the presence of a `fieldId`.

#### The wire: `JsonFilterNode`

```
type JsonFilterNode =
  | { and: JsonFilterNode[] }
  | { or:  JsonFilterNode[] }
  | { field: string;
      op: WireOp;
      value: unknown }
```

No identifiers, no labels, no types — only what is needed to build a WHERE. This is exactly the shape `parseFilterTree` accepts.

### Outbound: `treeToJsonFilter(tree, now?, options?)`

1. **An empty tree is discarded.** `null` or a group with no children → the result is `null`, and the caller simply does not put the parameter in the URL.
   _treeToJsonFilter → null_
2. **Incomplete rules drop out.** `isRuleComplete` cuts off a rule with no value (an `actorId equals` with an empty input), an empty array on a multi-value operator, a range missing one bound, a window with a zero count.
   _so that the server does not answer FILTER_INVALID_VALUE to a draft_
3. **Emptied groups drop out too.** A group whose children all fell away is not sent as `{or:[]}` — the server would reject it as `FILTER_INVALID_NODE`.
   _symmetric to the point above_
4. **Every surviving rule is converted to its wire form** — through the `UI_TO_WIRE` table or a dedicated branch for the composite operators.
   _an unknown op → throw, so that a new operator with no table entry fails loudly_
5. **The result is a JSON string**, ready to be substituted into `?filter=`. The `treeToJsonNode` variant returns an object — that is what the preview uses.
   _JSON.stringify_

**This pass's invariant:** the payload is always well-formed, even while drafts are sitting in the panel. The user is allowed a half-assembled rule on screen; it will not reach the wire.

> **The relativeDates option — the package's most loaded argument**
>
> By default `within_last` is **resolved**: a concrete ISO cut-off is computed at serialisation time and an ordinary `gte` goes out. That is right for a **link** — whoever opens a shared “in the last 7 days” sees the same rows the sender did.
>
> And it is **silently wrong** for a **saved** filter. An alarm rule of “not updated in 90 days”, written with a resolved cut-off, means “not updated since the day the rule was written” forever, and looks perfectly normal doing so. Hence: **pass `relativeDates` whenever a filter is saved and replayed; do not pass it when the filter goes into a URL.**
>
> In the whole admin UI the flag is passed in exactly one place — `AlarmRuleEditorPage`. That is the only screen where a filter is stored rather than linked.

### Inbound: `jsonFilterToTree(filter)`

- **It throws no exceptions.** A missing, empty or corrupt string yields `null`: a stale or hand-edited URL must not bring the page down.
- **A single rule at the root is wrapped in an `and` group** — the state's top level is always a group.
- **An unknown wire operator discards the rule** (checked through `Object.hasOwn`).
- **`null` is split by value:** `true` → `is_empty`, `false` → `is_not_empty`.
- **Percent signs and escaping are removed:** the `%…%` wrapper is stripped and `\%`/`\_`/`\\` are unpacked back into literal text — a value with a percent sign inside survives the round trip honestly.
- **A `gte`+`lte` pair on one field is folded into a `between`** (described above).
- **A corrupt `within_last` does not break the controls:** a non-numeric `n` becomes 1, and an unknown unit becomes `days`.

### What round-trips intact and what does not

| What                               | Round trip | Comment                                                                                                                                                                                              |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested groups of any depth         | complete   | Recursion in both directions, and the structure is preserved byte for byte                                                                                                                           |
| The OR combinator                  | complete   | The group's key _is_ the combinator — there is nothing to lose                                                                                                                                       |
| Every scalar operator              | complete   | The tables are mutually inverse                                                                                                                                                                      |
| `contains` / `not_contains`        | complete   | The escaping is symmetric with the unescaping                                                                                                                                                        |
| `is_empty` / `is_not_empty`        | complete   | Split by the `true`/`false` value                                                                                                                                                                    |
| `within_last` with `relativeDates` | complete   | The `{n, unit}` shape survives the round trip exactly                                                                                                                                                |
| `within_last` without the flag     | one-way    | It leaves as a `gte` with a cut-off and comes back as an absolute `gte` rule. Telling it apart from a genuine `gte` is impossible, and that is **deliberate**: a shared link must show the same rows |
| `between`                          | lossy      | It comes back as a `between` even if it was an honest `and` group. The WHERE is identical; only the editor differs                                                                                   |
| The React keys (`id`)              | no         | Regenerated on every parse — they are not meant to survive the round trip                                                                                                                            |
| The `like` operator                | lost       | The client never produces it and it has no entry in `WIRE_TO_UI`: a rule using it **silently drops out** of the lifted tree                                                                          |

## 07. The component's API

One import: `import { QueryBuilder, QueryBuilderPanel, type FilterField } from '@orthacms/query-builder-admin'`. The public surface is four components, eight utilities and a set of types.

### QueryBuilder — the headless controlled component

| Prop                | Type                        | Meaning                                                                                                        |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| fields              | readonly FilterField\[\]    | The available fields. Usually a mirror of the server's `FilterSchema`                                          |
| value               | FilterGroup \| null         | The current tree. `null` = no conditions                                                                       |
| onChange            | (next: FilterGroup) => void | Called on **every** edit. Whether to accumulate that in a draft or apply it at once is the consumer's business |
| showErrors          | boolean = false             | Whether to show an inline message under each invalid rule                                                      |
| renderRelationValue | RelationValueEditor?        | The value editor for a rule whose field carries a `relationTarget`. Without it such rules get a raw uuid input |
| portalContainer     | HTMLElement \| null         | The node nested popovers portal into. `document.body` by default                                               |

> **renderRelationValue must be passed as an element**
>
> `renderRelationValue={(p) => <Picker {...p} />}`, not `renderRelationValue={Picker}`. Otherwise the injected editor's hooks run in the rule cell's scope rather than in a component scope of their own.

### QueryBuilderDrawer — the slide-out panel

It owns the open state, the draft, the JSON preview and the Apply/Reset footer. The consumer passes a `trigger` (usually a “Filters (3)” button), so the badge and the permission check stay on their side.

| Prop                | Type                                | Meaning                                                |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| fields              | readonly FilterField\[\]            | —                                                      |
| value               | FilterGroup \| null                 | The **applied** filter (from the URL)                  |
| onApply             | (next: FilterGroup \| null) => void | Called on Apply (with the tree) or Reset (with `null`) |
| trigger             | ReactNode                           | Rendered inside a `DrawerTrigger asChild`              |
| direction           | 'left' \| 'right' = 'right'         | Which edge it slides in from                           |
| renderRelationValue | RelationValueEditor?                | Forwarded to `QueryBuilder`                            |

The drawer supplies its own portal container — vaul locks the page's scroll, and a popover portalled into `body` would end up outside the permitted subtree.

### QueryBuilderPanel — the inline accordion

An alternative to the drawer: a full-width section between the toolbar and the table that pushes the table down when expanded (with no overlay). The toggle button and the `open` state are held by the consumer; the panel holds the draft, the footer and the Esc behaviour.

| Prop                     | Type                  | Meaning                                                                                                                         |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| open / onOpenChange      | boolean / (b) => void | Whether it is expanded; called on collapse (Esc)                                                                                |
| fields / value / onApply | —                     | As for the drawer                                                                                                               |
| onApplied                | () => void            | After a **successful** Apply (but not a Reset). The alarm editor uses this to collapse the panel and return focus to the toggle |
| labelledBy               | string                | The toggle button's `id`: the section is labelled by it, and focus returns to it on Esc                                         |
| id                       | string                | The section's `id` — the target of the toggle's `aria-controls`                                                                 |
| fieldsPending            | boolean = false       | The fields are still loading — a spinner is drawn instead of the builder and Apply is disabled                                  |
| fieldsError              | boolean = false       | Loading the fields failed — an `Alert` with a “Try again” is drawn                                                              |
| onRetryFields            | () => void            | Retry the request                                                                                                               |

> **Why fieldsPending / fieldsError are mandatory rather than polish**
>
> The Apply gate rejects **every** rule whose field could not be resolved by `id`. Which means a panel handed an empty `fields` array while the surface loads (or after the request failed) can never apply a condition — and says nothing about why. An empty picker reads as a broken button. Reset stays enabled meanwhile: clearing an applied filter needs no field definitions.

### QueryBuilderSummary — the at-rest summary

One removable chip per applied condition (“Author · Email contains @lilly ×”) plus a “Clear all”. Removing a chip immediately re-applies the narrowed tree. AND/OR nesting is **flattened** here — the structure is edited in the panel and this is a compact reader.

An enum rule's value is rendered through the field's declared members, because the wire may hold an opaque id there, and the chip is the only place a rule is read after the panel collapses. A plugin's virtual field makes that obvious: segments filter by an audience's **uuid**, and an unresolved chip would read as “Can be seen by is one of d19a552b-…”. An unknown member falls back to the raw value rather than disappearing: a saved view can outlive the option it names, and a chip showing nothing would read as “no filter applied”.

### Utilities

| Export                                          | Purpose                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| treeToJsonFilter(tree, now?, options?)          | A tree → a JSON string for `?filter=`. `now` is injected so that tests can pin the cut-off |
| treeToJsonNode(...)                             | The same, but as an object — for the preview and for pretty-printing                       |
| jsonFilterToTree(filter)                        | A JSON string → a tree. Never throws                                                       |
| countRules(tree)                                | The number of leaves across the whole tree — for the “Filters (N)” badge                   |
| validateRule(rule, field)                       | The code of a rule's first error, or `null`                                                |
| treeHasInvalidRules(tree, fields)               | The Apply gate: does the tree contain even one invalid rule                                |
| opsForField(field)                              | A field's operators, taking the narrowing and the ordering into account                    |
| OPS_FOR_TYPE, OP_LABELS, UI_TO_WIRE, WIRE_TO_UI | The dictionaries; exported so that a consumer can reference them rather than rewrite them  |
| usePortalContainer()                            | The portal container from context — needed by an injected relation editor                  |

## 08. Step-by-step scenarios

### Scenario A. Assembling a filter in the entry registry

1. **The user presses “Filters” in the toolbar.** The consumer toggles `open`; the section expands with a `grid-template-rows: 0fr → 1fr` animation over ~150 ms, respecting `prefers-reduced-motion`.
   _QueryBuilderPanel_
2. **The panel syncs the draft with the applied filter.** On every opening, `draft ← value` and the `showErrors` flag is cleared: the user always edits the current state rather than what was left over from last time.
   _a useEffect on open_
3. **Focus moves into the first field cell.** The effect looks for the first `[role="combobox"]`. It re-runs once the fields have loaded — before that there is no builder on screen at all.
   _2.4.3_
4. **“Add rule”.** `fields[0]` is taken and the operator is set to `opsForField(first)[0]` — _not_ the type's first operator, so that a field with a narrowed list gets an operator it actually offers. The value is seeded by the operator's shape (`defaultValueForOp`). The live region announces “Condition added. N conditions in total”.
   _addRuleTo → onChange_
5. **The user picks a field.** Changing the field resets **both the operator and the value**: a rule must not be left in a state where “the operator was valid for the previous type”. The live region announces “\<path> selected. Operator and value reset for the new field type” — two context changes that used to happen in silence (3.2.2).
   _RuleRow.onChange_
6. **The user picks an operator and types a value.** Changing the operator re-seeds the value by its shape again. The JSON preview, if expanded, updates on every keystroke.
   _defaultValueForOp_
7. **“Apply”.** The gate comes first: `treeHasInvalidRules`. If it is clean — `onApply(draft)` (or `null` if there are no children), the URL changes and the table is rebuilt. The panel **stays expanded**: what changed is the table beneath it, and it is on screen.
   _applyFilter → updateParams({filter})_
8. **If it is dirty** — `showErrors` is switched on, a message naming the field appears under each broken rule, and on the next frame focus moves to **the first control of the first erroneous row** (not to the message itself — that is not focusable, and it is the control that needs changing).
   _3.3.1_
9. **The errors clear themselves.** As soon as the tree becomes valid, `showErrors` is reset — a second press of Apply is not required.
   _a useEffect on draft_
10. **The panel collapses.** The conditions settle as `QueryBuilderSummary` chips under the toolbar.
    _the consumer switches open off_

### Scenario B. Nesting a group and switching AND/OR

1. **“Add group” in any group's footer.** An empty subgroup is created with the `and` combinator by default. The insertion is addressed — `addGroupTo(tree, parentGroupId, newGroup())` — that is, it works at any depth rather than only at the root.
   _live region: “Group added”_
2. **A subgroup is drawn distinguishably** — a rounded **dashed** border with an indent, so that nesting reads without brackets. It has its own AND/OR switch on the left and a “Remove group” cross on the right.
   _isRoot=false_
3. **Subgroups are numbered.** Its four controls are named “Add rule to group 2”, “Add group inside group 2”, “Remove group 2”, “Combinator for group 2”. The numbering counts _among the subgroups_ rather than among all the children, so it does not shift when a rule is added between two groups. The root has no number — there is only one.
   _4.1.2_
4. **The switch is a two-item `SegmentedControl`.** The value changes through `updateCombinator(tree, groupId, v)`, also addressed by id. The builder has no global “mode”: **every group has its own combinator**.
   _and ↔ or_
5. **Depth is not limited on the client at all.** The `FilterGroup` type is recursive and so is the render. The only boundary is set by the server — `maxGroupDepth`.
   _see section 09_
6. **Deleting a group deletes it with its contents** — `removeNode` recursively finds the node by id and filters it out of the children. The root cannot be deleted: an empty root _is_ the “no filter” state.
   _treeOps_

### Scenario C. Saving a filter as an alarm rule

There are two entry points, and they give different results as regards dates.

1. **The quick path — “Save as alarm” in the registry's toolbar.** The button appears only when the URL holds a `?filter=` and the user has the `alarms:manage` permission; otherwise it is simply absent (a disabled control with no explanation is a worse answer than a missing one).
   _RECORDS_TOOLBAR_SLOT_
2. **The filter is read straight out of the address bar** and parsed with `JSON.parse` as it is. The dialog immediately counts the matches, so that the person naming the rule sees the size of what they are about to watch.
   _usePreviewAlarmRule_
3. **A consequence worth knowing:** a list filtered by “in the last N days” carries a **resolved cut-off** in its URL — so a rule saved from here gets an absolute date range rather than a sliding window. A URL simply cannot say which of the two was meant. Turning it into a sliding one is a one-line edit in the rule editor.
   _see section 06_
4. **The full path — the rule editor.** The builder panel is the same there, and so are the fields (`useFilterFields` + the same slot contributions), so a rule cannot by definition say more than the list says.
   _AlarmRuleEditorPage_
5. **Here Apply collapses the panel** — through `onApplied`, because the commit moves into the chips **above** the builder, and a panel left expanded would hide the one thing that has just changed. Focus returns to the toggle.
   _unlike in the registry_
6. **Saving serialises with `relativeDates: true`** and parses the result back into an object, because the rules API takes the tree as an object rather than as a string.
   _one serialisation implementation for both cases_
7. **Loading an existing rule** goes the reverse way: the stored object is run through `JSON.stringify` and fed into `jsonFilterToTree` — one `stringify` is cheaper than a second parser.
   _seeded once, by the rule's id_

> **The JSON preview in the rule editor shows something other than what will be saved**
>
> `JsonPreview` always serialises the draft **with the default options**, that is, with a resolved cut-off. In the alarm editor, meanwhile, the relative form is what gets saved. For a rule with a `within_last`, the preview and the stored tree diverge: the preview shows `{"op":"gte","value":"2026-05-28T…"}` and the database holds `{"op":"within_last","value":{"n":90,"unit":"days"}}`.

### Scenario D. A filter inside the related-entry picker dialog

1. **A bare `QueryBuilder` is mounted** inside a `Collapsible`, with no Apply — edits are applied at once, because the candidate list is right there.
   _RelationPickerFilters_
2. **A `portalContainer` is passed** — the dialog's element. A Radix dialog locks the page's scroll through react-remove-scroll, and the field picker's popover, portalled into `body`, would end up _outside_ the permitted subtree: its list would stretch a scrollbar but would not scroll with the wheel.
   _PortalContainerContext_
3. **The injected relation editor reads that same context** through the exported `usePortalContainer()` — otherwise the nested entry picker would repeat the same ailment one level deeper.
   _filters recursing inside a filter_

## 09. Limits and validation: client and server

There are two lines of checks. The client's mirrors the server's type coercion, so that a rule which passed the Apply gate is accepted by the server. That mirror is **not complete** — and knowing exactly where it is incomplete matters more than knowing where it agrees.

### The client's rule validation — 11 codes

| Code                 | When                                                                                                                    | Shown                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown_field        | The `fieldId` was not found among the `fields` — a filter restored from a URL or a saved view after a field was renamed | **Always**, regardless of `showErrors`: this is a broken rule, not an unfinished one                                                                    |
| operator_not_allowed | The operator is not in `opsForField(field)`. Reachable only from a hand-assembled or stale URL                          | **Always.** The operator cell is empty in that case (the `Select` has no matching item), and without a message the row would read as merely half-filled |
| value_required       | A scalar value is empty                                                                                                 | After Apply                                                                                                                                             |
| not_boolean          | Neither `"true"` nor `"false"` on a boolean field                                                                       | After Apply                                                                                                                                             |
| not_uuid             | Not the canonical 8-4-4-4-12 shape                                                                                      | After Apply                                                                                                                                             |
| not_number           | `Number(s)` is not finite                                                                                               | After Apply                                                                                                                                             |
| not_date             | `new Date(s)` yields NaN                                                                                                | After Apply                                                                                                                                             |
| range_required       | A `between` is missing one of its bounds                                                                                | After Apply                                                                                                                                             |
| range_invalid        | One of the bounds fails the type check                                                                                  | After Apply                                                                                                                                             |
| multi_required       | A multi-value operator's value is not an array, or the array is empty                                                   | After Apply                                                                                                                                             |
| count_required       | A `within_last`'s count is not a number, is ≤ 0, or the unit is missing                                                 | After Apply                                                                                                                                             |

The order of the checks is not accidental: **the operator's legality is checked first**, because every branch below assumes the operator makes sense for the field. Nothing in the interface can produce an illegal operator — the picker shows exactly `opsForField` — but `?filter=` is public and hand-editable, and without this check the gate happily sent an `ilike` on a `timestamptz` (the server answers 500) and an `eq "yes"` on a boolean (400). A filter the builder itself refuses to draw is one it must not agree to send.

Multi-value operators are checked **element by element** rather than merely for presence: free-form CSV on string and uuid fields easily produces elements the server will reject. Without that, a `uuid in (abc,def)` rule passed the gate and got a 400 already on the wire.

A UUID is checked **more strictly than on the server** — by the canonical 8-4-4-4-12 — whereas the server's regexp is looser. The reason: Postgres's `uuid` type rejects anything without that shape, so a loose check would end in a 400 from the driver anyway. A value that passes the client's check is guaranteed to pass both coercion and parsing in Postgres.

### The server's limits — `FilterSchema`

| Limit             | Default | What it counts                                                                                                                                                                                             | The code on violation         |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| maxNodes          | 50      | **Every node together** — groups and rules alike. The counter increments on each entry into `walkNode`                                                                                                     | FILTER_MAX_NODES_EXCEEDED     |
| maxGroupDepth     | 5       | The nesting depth of `and`/`or` groups                                                                                                                                                                     | FILTER_GROUP_DEPTH_EXCEEDED   |
| maxDepth          | 3       | **The dotted-path segments of one rule** — independently of group depth. For content it is derived as “hops + 1”: 2 hops by default, so `author.company.name` is reachable and `…country.name` is not      | FILTER_DEPTH_EXCEEDED         |
| maxInListLength   | 100     | The number of elements in one `in`/`nin` — separately from `maxNodes`, which counts whole rules rather than the elements inside one                                                                        | FILTER_MAX_IN_LIST_EXCEEDED   |
| FILTER_MAX_LENGTH | 4096    | The **string length** of the `filter` parameter. It lives not in the schema but in each consumer's DTO (`@MaxLength`) — activity, members, entries, the public API and saved views all use the same number | 400 from the `ValidationPipe` |

> **The client knows none of these five numbers**
>
> The package has no node counter, no depth counter, no string-length check and no limit on a CSV list's length. `treeHasInvalidRules` mirrors _leaf coercion_ and nothing else. A tree can be built arbitrarily deep and arbitrarily large, and a hundred comma-separated values can be pasted into it — the Apply gate will let it through, the URL will update, and the refusal will arrive from the server as a list-loading error.
>
> In practice this comes down to patience: typing 50 nodes with a mouse is hard work. But a `between` costs **three** nodes (a group + two rules) while counting as one in the “Filters (N)” badge, so the budget is spent faster than the counter shows, and a filter restored from a saved view may already be over the line.

### Two more numbers worth knowing

#### `MAX_WITHIN_LAST` = 100,000 (client)

The input is clamped to `[1, 100000]` on every keystroke, and the serialiser additionally bounds the cut-off to a representable instant. The reason is purely practical: the preview serialises the live draft on every key, and a user typing a long number used to get `new Date(NaN).toISOString()` — a `RangeError` thrown during render, between which and the page there is no boundary whatsoever. Clamping makes the serialiser total: a meaningless window degenerates into the widest representable one, and it is Apply that refuses.

#### `MAX_WITHIN_LAST_N` = 10,000,000 (server)

Here the boundary is about Postgres: `now() - make_interval(days => 1e9)` overflows the timestamp range and yields a `22008`, which the caller sees as a 500. The client is stricter than the server on the _number_ but not on the _duration_: 100,000 days is about 274 years, whereas 100,000 minutes is only 69 days. The limit counts the counter, not the window.

### What the server does that the client does not mirror at all

- **Negations are NULL-inclusive.** `ne`, `nin` and `nilike` are translated as `predicate OR col IS NULL`. In SQL, three-valued logic would yield NULL (that is, “no match”) on an empty column, and “Title does not contain foo” would quietly hide every draft with an empty title. An empty value is not the value being excluded.
- **Negation on a relation path is rewritten.** `EXISTS(… NOT p …)` becomes `NOT EXISTS(… p …)`. These are not the same thing as soon as a relation can hold more than one row: “tags do not contain x” in the first form means “there is some tag other than x”, which an entry tagged `[x, y]` satisfies.
- **Every relation carries its own `scope`** — the workspace boundary and the guard against soft-deleted rows, glued into the EXISTS subquery. Without it a relation filter would walk rows that the root query itself excludes.
- **An empty `in` is rejected** (`FILTER_EMPTY_IN_LIST`): Drizzle emits `IN ()` as `false` and `NOT IN ()` as `true` — a silent zero or a silent inversion in place of the user's intent.
- **Virtual fields** (`extensionFields`) go to a host handler and become a subquery inlined at the leaf's position — which is why they sit happily inside the same AND/OR groups as ordinary rules.

## 10. Accessibility and the keyboard

Accessibility here is not a separate layer over a finished component but the reason some parts are written the way they are. The `ORT-157` ticket went through the whole builder; below is what it changed and why.

### The problem it started from: the rows were indistinguishable

The accessibility tree with three rules on screen read literally like this:

```
combobox "Field"   combobox "Operator"   combobox "Value"   button "Remove rule"
combobox "Field"   combobox "Operator"   combobox "Value"   button "Remove rule"
combobox "Field"   combobox "Operator"   combobox "Value"   button "Remove rule"
```

The second row was in no way different from the third, and after pressing one of five “Remove rule” buttons there was nowhere to learn which had disappeared (4.1.2, 2.4.6). The fix is **row identity**: the `fieldPath(intl, fields, fieldId)` function assembles a localised “Author · Email” path, and it is substituted into the name of every control on the row and into its error message. The summary chips used exactly the same composition — now there is one implementation, and a chip cannot diverge in naming from the row that produced it. For a field that is no longer in the schema, the raw `fieldId` is returned: a broken rule must be identifiable too, and its id is the only handle left.

### The controls' names

| Element                   | Accessible name                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The field cell            | “Field for Author · Email”                                                                                                                            |
| The operator cell         | “Operator for Author · Email”                                                                                                                         |
| The rule's remove button  | “Remove condition: Author · Email”                                                                                                                    |
| The error message         | “Author · Email: Value required” — 3.3.1 requires the element in error to be named                                                                    |
| The root group's controls | Plain ones: “Add rule”, “Add group”, “Combinator”                                                                                                     |
| Subgroup N's controls     | “Add rule to group N”, “Add group inside group N”, “Remove group N”, “Combinator for group N”; the section itself is a `role="group"` named “Group N” |
| A summary chip            | “Remove condition Author · Email contains”                                                                                                            |

### Focus management on deletion

The button just pressed disappears along with the row — focus fell onto `<body>`, and the next Tab restarted the traversal from the top of the document. Deleting the third condition of five cost a full second pass (2.4.3). Now:

1. **The elements are captured _before_ the deletion.** The handler passes the pressed element itself upwards; the list of `[data-qb-remove]` buttons is taken from the live DOM.
   _onRemoveFocus(event.currentTarget)_
2. **The target is chosen by the list's direction:** the next remove button, then the previous one, then that group's “Add rule”. Deleting three rows in a row, the user stays in one place rather than flying to the top each time.
   _React keys the rows — all but the deleted one keep their DOM nodes_
3. **Focus is set in a `requestAnimationFrame`** — after the commit that unmounts the row. Set earlier, it would be cancelled by the browser blurring the disappearing element.
   _the same applies to the summary chips_

The summary chips use the same logic (the next chip, then the previous), but with an honest caveat: when the last chip is removed, the whole summary unmounts and there is nothing here to land on. What remains is the consumer's own control, and naming a target across that boundary would tie the package to every host.

### The live region

One `role="status"` named “Filter builder status” for the whole builder. **Polite, not assertive** — the user did this deliberately and is not interrupted. Four events are announced: a condition added (with the resulting count), one removed (with how many remain), a group added, and **a field changed**. Editing the operator and the value is not announced — that is a user watching their own keystroke land on screen. A field change, though, is announced without fail: it resets the operator and swaps the value editor, that is, changes the context twice, and used to do so in silence (3.2.2).

### The keyboard in the field picker

| Key        | Action                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Enter      | On the trigger — open. In the list: pick a field, or expand/collapse a relation                                       |
| ↓ / ↑      | Move to the next/previous **navigable** row — headings are skipped. The traversal **wraps**, modulo the list's length |
| Esc        | Close the popover                                                                                                     |
| Tab        | Leave the popover entirely — the rows are marked `tabIndex={-1}`, otherwise Tab would walk every field in the schema  |
| any typing | Goes into the search box: focus never leaves it                                                                       |

> **Why both halves are mandatory**
>
> The search box carries an `aria-controls` and a live `aria-activedescendant`. Arrow-key highlighting **without** an `aria-activedescendant` is a purely visual state that assistive technology never learns about. And rows reachable only through Tab would announce a position the keyboard can do nothing with. Both are needed.

Two more keyboard details that are easy to lose in an edit: the highlight resets to the first navigable row on **opening and on a change of query**, but _not_ on expanding a relation — otherwise every expansion would jerk both the highlight and the scroll back to the top. And `scrollIntoView({block:'nearest'})` follows the highlight rather than a re-render of the list, so for the same reason it does not fire on an expansion.

### The panel as a region

- The section is a `role="region"`, labelled by the toggle button through `aria-labelledby`.
- When collapsed it is given `inert`: the content is not focusable and not read, although it remains in the DOM (the height is animated with a grid).
- **Esc returns focus to the toggle** — and does so in a `requestAnimationFrame` after the commit that sets `inert`. The panel deliberately moves focus _inwards_ on opening, and before `ORT-157` did nothing on the way out.
- Esc is skipped if `event.defaultPrevented`: an open picker popover must eat its own Escape first.
- `aria-invalid` is attached to `EnumMultiSelect`'s **checkboxes themselves** rather than to the group: it is an input-widget attribute, ARIA 1.2 does not list it on `role="group"`, so on the group it communicated the state to nobody at all.
- The expansion animation respects `prefers-reduced-motion` (`motion-reduce:transition-none`); the rule list is height-bounded (`22rem`) and scrolls within itself so that the table does not travel off screen.

## 11. Invariants

What must remain true after any edit to the package. Violating each point is a specific defect that has happened at least once already.

- **I-01** — **The payload on the wire is always well-formed.** Incomplete rules and emptied groups drop out during serialisation. The user is entitled to hold a draft on screen; the server is not entitled to see it.
- **I-02** — **The client never writes a bare operator string.** Every leaf goes through `UI_TO_WIRE` or through an explicit branch of the serialiser. An operator added to `OP` with no table entry and no branch must **throw** rather than travel silently.
- **I-03** — **A rule always has a field.** The model knows no “rule without a field” state, which is why the field cell has no destructive “clear” — it simply reopens.
- **I-04** — **An unknown field is not substituted.** `RuleRow` resolves the field by `id` _without_ falling back to `fields[0]`. Substituting someone else's field would drive the operator list and the validation by the wrong type while the rule still carries the old path: the row would look valid, and the Apply gate (which also resolves by id) would silently refuse the commit.
- **I-05** — **Changing the field resets both the operator and the value.** Otherwise the rule is left with an operator legal for the previous type — and gets a 400 on the wire. Changing the operator likewise re-seeds the value by its shape (`defaultValueForOp`), otherwise composite operators get an `''` and break the controls with a controlled → uncontrolled transition.
- **I-06** — **The default operator comes from `opsForField`, not from `OPS_FOR_TYPE`.** The order a field declares _is_ its default. Seeding from the type drove “Add rule” and the operator picker off two different dictionaries.
- **I-07** — **A declared operator list narrows but does not widen.** It is filtered by what the type permits; a narrowing that matched nothing falls back to the type's full set — a picker with zero options is worse than a wrong order.
- **I-08** — **Every dictionary is read through `Object.hasOwn`.** `OPS_FOR_TYPE`, `UI_TO_WIRE`, `WIRE_TO_UI`, `MS_PER_UNIT`, and the server's `OPERATORS_BY_TYPE`. These are ordinary object literals, and the key arrives from a public URL or from a schema built at runtime: `WIRE_TO_UI['constructor']` would return `Object`, and the `?? null` would never fire.
- **I-09** — **The serialiser is total.** No value a user can type may throw during render: the preview serialises the live draft on every keystroke. Hence the clamping of `within_last` to a representable instant and the fallback of an unknown unit to days.
- **I-10** — **The deserialiser does not throw.** Corrupt JSON, an unknown operator, a junk value — each yields `null` or a discarded rule. A user is capable of hand-editing `?filter=`, and the page must survive it.
- **I-11** — **Every group owns its combinator.** There is no global “AND/OR mode”; the root's switch and each subgroup's are independent, and every mutation is addressed by a node's `id` rather than by position.
- **I-12** — **React keys are never serialised.** `FilterGroup.id` and `FilterRule.id` are client-side; they are regenerated when the URL is parsed.
- **I-13** — **An empty tree is `null`, not an empty group.** `treeToJsonFilter` returns `null` and the consumer removes the parameter from the URL. Sending `{and:[]}` would get a `FILTER_INVALID_NODE`.
- **I-14** — **The draft is synced with the applied value on every opening.** For the drawer and the panel alike. Closing without Apply discards the edits and clears the previous attempt's error state.
- **I-15** — **The Apply gate lets through no invalid rule**, and in the absence of field definitions refuses _all_ of them. That is why the fields' loading and error states are part of the panel's contract rather than polish: an empty picker reads as a dead button.
- **I-16** — **A broken rule always announces itself; an unfinished one does so after Apply.** `unknown_field` and `operator_not_allowed` ignore `showErrors`: the user did not type them and has nothing to finish.
- **I-17** — **A filter the builder refuses to draw is one it does not send.** The operator's legality is checked before every value check.
- **I-18** — **Focus after deleting a node stays inside the builder.** The target is captured before the unmount and set in a `requestAnimationFrame` after it.
- **I-19** — **The picker's list is a valid listbox.** Every navigable row is an `option` (the relation row too, with an `aria-expanded` instead of a value), headings are `presentation`, focus stays on the search box, and `aria-activedescendant` is live.
- **I-20** — **Inside a scroll-locking container, popovers portal into it.** The `portalContainer` is published through context and must be read both by the field picker and by an injected relation editor, otherwise their lists do not scroll with the wheel.
- **I-21** — **`relativeDates` is passed if and only if the filter is stored.** A link gets a frozen cut-off, a stored rule a sliding window. An error in either direction is silent and looks normal.

## 12. Testing checklist

The package's unit tests cover only what a browser does not reach cheaply: `utils/fieldTree` and `utils/operators`. Everything behavioural lives in `apps/admin-e2e`, where there is a real browser. Below is what to check by hand or with a new test.

### The grammar and the round trip

- **A flat condition of two rules** — `{"and":[…, …]}` in the URL, and loading it back gives the same two rows
- **An OR at the root** — switch the root's combinator, apply, reload: the combinator survived
- **A nested group** — add a subgroup with an OR inside an AND, apply, reload: the structure came back intact rather than flattened
- **Two subgroups side by side** — both are restored, and the numbering in the control names does not shift when a rule is added between them
- **`contains` with special characters** — the value `50%_off` leaves as `%50\%\_off%` and comes back into the input literally
- **`between` round trip** — it leaves as a group of two rules and returns as one composite editor, with the badge counting 1
- **An honest `gte`+`lte` group** — it will come back as a `between`; confirm the resulting result set matches
- **`is not empty`** — on the wire it is `{"op":"null","value":false}`, and it lifts back as `is_not_empty` rather than `is_empty`
- **`within_last` in a link** — a resolved `gte` in the URL; after a reload the row reads as an absolute “greater than or equal to”
- **`within_last` in an alarm rule** — `{"op":"within_last","value":{"n":…,"unit":…}}` in the database; reopening the rule gives the same composite editor
- **A corrupt `?filter=`** — a junk string, truncated JSON, `{"op":"constructor"}`: the page loads, the filter is empty, and nothing crashes

### Operators and field types

- **Each of the six types** — the operator picker offers exactly what is in `OPS_FOR_TYPE`; a date has no `equals`, and a boolean has only `equals`
- **A field with a narrowed `operators`** — “Has locale” offers only `equals` and `is one of`; “Can be seen by” opens on `is one of` rather than on `equals`
- **A narrowing that does not intersect with the type** — a fallback to the type's full set rather than an empty list
- **Changing the field to a different type** — the operator and value are reset, the value editor is swapped, and the live region announced it
- **Changing the operator to a composite one** — `between` yields `{from:'',to:''}`, `within_last` yields `{n:7,unit:'days'}`, a multi-value one yields `[]`; no input goes from controlled to uncontrolled
- **enum + a multi-value operator** — checkboxes over the declared members, and a foreign value cannot be typed
- **A relation field with a `relationTarget`** — an entry picker instead of a uuid input; with a single-value operator the choice reduces to one id

### Validation and the Apply gate

- **Each of the 11 codes** — in particular a `uuid is one of` with a non-uuid element must block Apply (there is an e2e test on activity)
- **The errors clear themselves** — fix the value: the messages disappear without a second Apply
- **Focus after a failed Apply** — on the first control of the first erroneous row, not on the button and not on the error text
- **An unknown field** — rename a field in the schema and open an old link: the row reports `unknown_field` at once, and the field cell is still there and allows re-picking
- **An illegal operator from a URL** — an `ilike` on a date: the message appears immediately and Apply does not fire
- **The fields are loading** — a spinner instead of the builder, Apply disabled, Reset enabled
- **Loading the fields failed** — an `Alert` with “Try again”, the applied filter still in force and the table loading
- **Exceeding the server's limits** — 51 nodes, 6 levels of groups, 101 values in a CSV, a string longer than 4096: the client lets it through, so check that the 400 is presented correctly on screen

### The keyboard and accessibility

- **axe on an expanded panel with a rule** — present in the members' and the activity's e2e
- **Arrow-key traversal of the picker** — headings are skipped, the traversal wraps, and `aria-activedescendant` follows the highlight
- **Enter on a relation row** — expands it rather than selecting it; the highlight and the scroll stay put
- **Tab inside the popover** — leaves it rather than walking every field in the schema
- **Esc in the panel** — collapses it and returns focus to the toggle; with a popover open, the first Esc closes the popover
- **Deleting the third of five conditions** — focus on the next row's remove button, and the next Tab does not start from the top of the document
- **Deleting a summary chip** — focus moves to the neighbouring chip; deleting the last one makes the whole summary disappear
- **The live region** — announces adding/removing a condition, adding a group and changing a field; does not announce a value edit
- **Control names inside subgroups** — “Add rule to group 2” and so on, with the root left unnumbered

### Integration with the consumers

- **Wheel scrolling inside the drawer and the dialog** — the field picker's list scrolls with the wheel and not only with the scrollbar (the `portalContainer` regression)
- **The “Filters (N)” badge** — counts the leaves across the whole tree, nested groups included
- **Enum value chips** — “Can be seen by is one of Acme” rather than a uuid; an unknown member shows the raw value
- **Removing a chip** — immediately re-applies the narrowed tree; removing the last one yields `null` rather than an empty group
- **Slot contributions** — the i18n and segments fields appear under their own headings; on a type without i18n they are absent
- **Save as alarm** — the button is absent without a filter in the URL and without the `alarms:manage` permission
- **Apply in the alarm editor** — collapses the panel, updates the chips, recomputes the match count and returns focus to the toggle
- **Copying the JSON** — over HTTP or with clipboard access denied, the button stays in its initial state and the console holds no unhandled promise rejection

## 13. Boundaries of responsibility

The boundaries explain why the package lacks things people expect of it — and why adding them here would be a mistake.

#### Not a data layer

Not a single request. The field schema arrives as a prop; the related-entry picker is injected through `renderRelationValue`. That is exactly why one component works both where the fields are a static array of six rows and where they arrive from an API together with a recursive relation graph.

#### Not the URL's owner

The package knows nothing of the router or of `?filter=`. It hands out a string and takes a string. Whether to put it into the address, into a request body or into a form field is the consumer's decision.

#### Not the source of truth about what is filterable

The allowlist of paths that reach SQL is held by the server's `FilterSchema`. For content the surface is built **on the server** and served by the `/filter-fields` endpoint — precisely so that the client's mirror cannot diverge from it. The old client-side reconstruction, `filterFieldsFromSchema`, has been removed: with a relation graph such a divergence becomes 400s the user can see.

#### Not a whole-tree validator

The Apply gate mirrors _leaf coercion_. The node count, the group depth, the string length, the `in` list's length are entirely server-side, and the client does not know them. Duplicating them here would create a fifth place where the numbers can diverge.

#### Not a translator into SQL

The preview shows JSON, not SQL. A SQL tab is listed under “Deferred” and is deliberately postponed: what a tree turns into depends on the relation's kind, on the workspace's `scope` and on the rewriting of negations — all that could be shown here is a plausible fabrication.

#### Not a store for filters

Saved views belong to content and alarm rules to alarms. The package can do exactly two things: serialise and parse. What to do with the result is not its question.

#### Not about permissions

Not a single permission check. The button is hidden by the consumer (`useHasPermission`), and field availability is limited by the server — content's filter surface cuts off relations into types the workspace was not granted.

#### Not about sorting and pagination

The builder answers only “which rows”. The order, the page size and the column choice are other toolbar controls with URL parameters of their own.

### What is deliberately deferred

- **A fallback to the composite string.** The old bracketed grammar is no longer accepted on the client at all: by the time a URL reaches `jsonFilterToTree`, it was written by this very package.
- **The SQL preview tab** — see above.
- **Built-in foreign-key pickers** — closed off by the `renderRelationValue` seam.

## 14. Discrepancies between the code and the documentation

Every statement above was checked against the implementation. Below are the places where the package's `AGENTS.md` or its comments diverge from what the code does, plus two functional asymmetries the documentation is silent about.

| Where                                         | What it says                                                                                              | What is actually the case                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md, “Key exports” — QueryBuilderDrawer | “consumer passes a `trigger` (used by the **members / activity** list pages)”                             | The activity log moved to `QueryBuilderPanel` long ago. The drawer's only consumer in the whole repository is `MembersPage`                                                                                                                                                                                                               |
| AGENTS.md, “Key exports” — QueryBuilderPanel  | “collapses on Apply / Esc”                                                                                | The panel **stays expanded** after Apply — a comment in the code says so outright (“The panel stays open after Apply”). Only Esc collapses it, or the consumer itself through the `onApplied` callback, which is what the alarm editor does                                                                                               |
| AGENTS.md, the same place                     | “(used by the **content records** page)”                                                                  | The panel is used by three pages: the entry registry, the activity log and the alarm rule editor                                                                                                                                                                                                                                          |
| AGENTS.md, “Wire grammar”                     | A six-row mapping table                                                                                   | Incomplete: it does not name `not_contains` → `nilike`, `not_one_of` → `nin`, or `is_not_empty` → `null` with the value `false`. Nor does it mention the escaping of LIKE metacharacters in `contains`/`not_contains`, even though the round trip's correctness depends on it                                                             |
| utils/wireOp.ts, the `UI_TO_WIRE` JSDoc       | “`OP.Between` and `OP.WithinLast` are intentionally **not** in this table”                                | **Five** operators are absent from the table, not two: `not_contains`, `not_one_of` and `is_not_empty` join them, also handled directly in `ruleToJson`. Accordingly `UI_TO_WIRE` and `WIRE_TO_UI` are not mutually inverse (9 entries versus 11), and that is stated nowhere                                                             |
| AGENTS.md, “Commands”                         | “what lives here is what a browser cannot reach cheaply, **currently `utils/fieldTree`**”                 | There are two unit specs: `fieldTree.spec.ts` and `operators.spec.ts` (five tests on `opsForField` — ordering, narrowing, fallback, an unknown type)                                                                                                                                                                                      |
| QueryBuilderDrawer/JsonPreview                | “the live wire format”                                                                                    | The preview always serialises **with the default options**. In the alarm rule editor the save goes with `relativeDates: true`, so for a rule with a `within_last` the preview shows a `gte` with a frozen cut-off while a `within_last` goes into the database. What is shown there is not what is sent                                   |
| utils/validateRule.ts, JSDoc                  | “Mirrors the BE coercion rules in `resolve-leaf.ts` so a rule that passes here is one the server accepts” | True only for **one leaf**. At the tree level there is no mirror at all: `maxNodes` (50), `maxGroupDepth` (5), `maxInListLength` (100) and `FILTER_MAX_LENGTH` (4096) are not checked by the client, and a rule that passed the gate can travel as part of a tree the server will reject                                                  |
| FieldPicker — `typeTagFor`                    | The type tag “shows the field's type”                                                                     | The `uuid` type is displayed with a **“relation”** tag unconditionally, even when no `relationTarget` is set. In the activity log the `actorId` field is an ordinary uuid column but is labelled a relation in the picker. The tag is marked `aria-hidden`, so the defect is purely visual — but misleading                               |
| users-admin, `MEMBERS_FILTER_FIELDS`          | The comment: “the `role.key` dotted path resolves to the BE's `role` relation”                            | The path is dotted, but the field declares no `group`. `buildFieldTree` therefore labels the relation node with the fallback descriptor `{id:'qb.field.relation.role', defaultMessage:'role'}` — and an **untranslatable lowercase “role” heading** appears in the picker. It is the repository's only dotted `id` without aligned crumbs |
| The grammar — the `like` operator             | The server's `FilterOperator` dictionary holds 13 operators                                               | The case-sensitive `like` has no entry in `WIRE_TO_UI`, so a `?filter=` containing it lifts into a tree with the rule **silently discarded**: the user sees a filter less strict than the one in the link, with no message. No admin-UI consumer produces `like`, but a URL is a public surface                                           |
| The “Filters (N)” badge vs. the node budget   | `countRules` — “the number of conditions the user expects”                                                | A `between` rule counts as **1** in the badge and costs **3** nodes on the server (a group plus two rules). Against a 50-node limit the divergence accumulates unnoticed                                                                                                                                                                  |
| The client's `MAX_WITHIN_LAST`                | “100,000 days reaches back about 274 years — far past any real content”                                   | The limit counts the **counter** rather than the duration, and is the same for all three units: 100,000 minutes is 69 days. The reference to 274 years is true for exactly one unit out of three                                                                                                                                          |

> **What this dossier does not contain**
>
> The analysis of translating a tree into SQL (`tree-to-drizzle.ts`, `relation-exists.ts`, the five relation kinds and their `scope`) is described here only as far as is needed to understand an operator's meaning. That is `@orthacms/utils-server`'s responsibility and the subject of a dossier of its own. Content's saved views and the alarms engine are likewise not covered — they appear here only as _consumers_ of the grammar.

---

**A component dossier.** The skeleton is the same as a plugin dossier's, but the sections are adapted to the fact that this is a UI library rather than a plugin: in place of the data model, the HTTP API and configuration come the grammar, the operators, the component's API and the state ⇄ wire round trip. The sections the package does not have (database tables, routes, permissions, migrations) are simply absent here.

The source is the whole of `packages/query-builder/admin` (12 components, 12 utility modules, 2 type modules), the grammar's server-side consumer `packages/utils/server/src/lib/filters`, and all five mount points and both slot contributions. The `AGENTS.md` files were used as a skeleton, but every statement was verified against the implementation — the divergences are collected in section 14.
