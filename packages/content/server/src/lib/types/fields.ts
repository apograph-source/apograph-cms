/**
 * Field-spec contracts for code-defined content types. A field spec is a
 * plain, JSON-serializable description (plus a lazy relation thunk) that
 * drives three things at once: the generated Postgres column, server-side
 * validation, and the admin's dynamic form rendering.
 */

import type { RichTextStructureMode } from '@orthacms/content-domain';
import type { AnyContentType } from './content-type';

/**
 * Built-in field type identifiers. The runtime object is the single source of
 * truth; the {@link FieldType} union is derived from it so the two can never
 * drift, and every `switch`/comparison references `CONTENT_FIELD_TYPE.*`
 * instead of a bare string literal.
 */
export const CONTENT_FIELD_TYPE = {
    Text: 'text',
    RichText: 'richtext',
    Number: 'number',
    Money: 'money',
    Boolean: 'boolean',
    Date: 'date',
    Datetime: 'datetime',
    Select: 'select',
    Multiselect: 'multiselect',
    Json: 'json',
    Relation: 'relation',
    Media: 'media'
} as const;

/** Built-in field type identifiers. */
export type FieldType =
    (typeof CONTENT_FIELD_TYPE)[keyof typeof CONTENT_FIELD_TYPE];

/**
 * The canonical "no value" test for a field value — null/undefined, a blank
 * (whitespace-only) string, or an empty array. The single definition shared by
 * the validation service (where an empty value either trips `required` or is
 * skipped) and the row mappers (where the admin seeds every untouched field with
 * `''`/`[]`, which storage must collapse to `null` rather than coerce, e.g.
 * `new Date('')` → Invalid Date). One authority so the two can't drift.
 */
export function isEmptyFieldValue(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
    );
}

/**
 * Presentation props forwarded verbatim to the admin (and any other
 * frontend) via `GET /api/content-schema`. The known keys are what the
 * stock admin reads; everything else passes through untouched, so a
 * project can attach its own hints. Must stay JSON-serializable.
 */
export interface AdminProps {
    /** Human label; falls back to the field name. */
    label?: string;
    /** Help text rendered under the input. */
    description?: string;
    /** Input placeholder. */
    placeholder?: string;
    /** Render hint, e.g. 'textarea', 'slug', 'color'. */
    widget?: string;
    /** Hide from the default form (still served by the API). */
    hidden?: boolean;
    /** Project-specific extras — passed through untouched. */
    [key: string]: unknown;
}

/**
 * Validation rules, serialized to the admin so the same constraints
 * render client-side. The server's EntryValidationService is the
 * authority; the admin copy is a courtesy.
 */
export interface FieldValidation {
    /**
     * Minimum length (text/richtext). On a `richtext` field this counts the
     * body's **text**, not its markup.
     */
    minLength?: number;
    /**
     * Maximum length (text/richtext). On a `richtext` field this counts the
     * body's **text**, not its markup.
     */
    maxLength?: number;
    /** ECMAScript regex source the value must match (text/richtext). */
    pattern?: string;
    /**
     * Structural checking of a `richtext` body — heading order, table headers,
     * link text, language markers. Defaults to `'on'`; `'off'` is the opt-out
     * for a body that is not a document.
     * @see RichTextStructureMode
     */
    structure?: RichTextStructureMode;
    /** Minimum numeric value (number/money). */
    min?: number;
    /** Maximum numeric value (number/money). */
    max?: number;
    /** Restrict to whole numbers (number). */
    integer?: boolean;
}

/** Referential action when a related row is deleted. */
export type RelationOnDelete = 'cascade' | 'set null' | 'restrict';

/**
 * Marks a relation field as the **inverse** (back-reference) of a
 * storage-backed relation owned by another type — the read/write "other side"
 * of a two-way relation. An inverse field generates **no storage of its own**:
 * it reuses the owning relation's FK column / join table, so editing either side
 * mutates the same links and the two can never drift.
 */
export interface RelationInverseSpec {
    /** The field name on the owning type ({@link RelationSpec.to}) that backs the link. */
    field: string;
}

/** Runtime relation config carried by a relation field spec. */
export interface RelationSpec {
    /** Lazy target — a thunk so mutually-referencing files can import each other. */
    to: () => AnyContentType;
    /** Many-to-many (via a generated join table) vs a single FK column. */
    many: boolean;
    /** FK referential action; ignored for `many` (join rows just disappear). */
    onDelete: RelationOnDelete;
    /**
     * Enforce a one-to-one relation: a `UNIQUE` constraint on the single FK
     * column so at most one owner can point at a given target. Nullable-unique,
     * so any number of owners may have no relation (Postgres permits many NULLs
     * in a UNIQUE column). Meaningless — and rejected at define time — for a
     * `many` relation, whose links live in a join table.
     */
    unique: boolean;
    /**
     * Whether an edit in one locale propagates this link to the record's other
     * locale rows. Inert unless the **owner** is `i18n` (a type with no locale
     * siblings has nothing to propagate to) and on an inverse field (which owns
     * no storage of its own — it reuses the owning side's).
     *
     * `true` (the default) says the link belongs to the **record**, not to the
     * language, which is what most relations mean: tagging the English article
     * tags the German one too. *How* that is stored depends on the target — see
     * `relationLocaleSync` in `extension/relation-locale-sync.ts`, which is the
     * one place the rule lives.
     *
     * `false` gives each locale its own independent links. `localized: true` on
     * a relation field is an alias for it; setting both in contradiction is
     * rejected at define time.
     */
    syncAcrossLocales: boolean;
    /**
     * Present only on an **inverse** field: it owns no column/table and reads the
     * link from {@link to}'s `field` (with source/target swapped). `to` is the
     * owning type; `onDelete`/`unique`/`syncAcrossLocales` are inert.
     */
    inverse?: RelationInverseSpec;
}

/** Options shared by every field builder. */
export interface BaseFieldOptions {
    /** Reject empty values; the column becomes NOT NULL. */
    required?: boolean;
    /**
     * BCP-47 tag naming the language this field's content is written in, when
     * it is not the entry's own (WCAG 3.1.2 — language of parts). For the case
     * where the *whole* field is in another language: an `originalTitle`, a
     * `motto`. Inside a `richtext` body a passage carries its own `lang`, so
     * this is not how a quotation is marked.
     *
     * Checked for well-formedness at define time — a POSIX locale (`en_US`) or
     * a language name (`english`… well, that one is merely unregistered) is
     * ignored outright by assistive tech, so it is caught at boot rather than
     * shipped.
     */
    lang?: string;
    /**
     * The value differs per locale (valid only on an `i18n` content type —
     * rejected at define time otherwise). A field without the flag is
     * **shared** across a translation group: the bound localization plugin
     * syncs its value to every sibling row on update and copies it when a
     * translation is created.
     */
    localized?: boolean;
    /** Presentation props forwarded to the admin. */
    admin?: AdminProps;
}

export interface TextFieldOptions extends BaseFieldOptions {
    minLength?: number;
    maxLength?: number;
    /** Regex source the value must match. */
    pattern?: string;
}

/** Options for `field.richtext()` — a structured long-form body. */
export interface RichTextFieldOptions extends BaseFieldOptions {
    /** Minimum length, counted over the body's text (not its markup). */
    minLength?: number;
    /** Maximum length, counted over the body's text (not its markup). */
    maxLength?: number;
    /**
     * Structural checking — heading order, table headers, link text, language
     * markers. Defaults to `'on'`. Turn it `'off'` for a body that is not a
     * document (a hand-maintained fragment, an email template), where the rules
     * would be measuring the wrong thing.
     */
    structure?: RichTextStructureMode;
}

export interface NumberFieldOptions extends BaseFieldOptions {
    min?: number;
    max?: number;
    /** Restrict to whole numbers. */
    integer?: boolean;
}

/** Money is stored as integer minor units (cents) — exact, no float drift. */
export interface MoneyFieldOptions extends BaseFieldOptions {
    /** Minimum amount in minor units. */
    min?: number;
    /** Maximum amount in minor units. */
    max?: number;
}

export interface SelectFieldOptions<
    TOptions extends readonly string[] = readonly string[]
> extends BaseFieldOptions {
    /** Allowed values. */
    options: TOptions;
}

/** The coarse media categories the library groups assets by. */
export type MediaKindValue =
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'archive';

/** The valid {@link MediaKindValue}s, for define-time validation of `accept`. */
export const MEDIA_KIND_VALUES: readonly MediaKindValue[] = [
    'image',
    'video',
    'audio',
    'document',
    'archive'
];

/**
 * Restricts which assets a media field accepts. Both filters are optional and
 * combine as OR within each list; an asset passes when it matches **any** listed
 * kind **or** any listed MIME pattern (an absent `accept`, or one with neither
 * list, accepts anything). A MIME pattern is either exact (`image/png`) or a
 * `type/*` wildcard (`image/*`). Enforced server-side on save.
 */
export interface MediaAccept {
    /** Allowed coarse kinds (image/video/audio/document/archive). */
    kinds?: readonly MediaKindValue[];
    /** Allowed MIME types — exact (`application/pdf`) or wildcard (`image/*`). */
    mimeTypes?: readonly string[];
}

/** Options for `field.media()` — attach one or more Media Library assets. */
export interface MediaFieldOptions extends BaseFieldOptions {
    /** Hold an ordered list of assets rather than a single one. Defaults false. */
    multiple?: boolean;
    /** Restrict the accepted assets by kind and/or MIME. Defaults to any asset. */
    accept?: MediaAccept;
}

export interface RelationFieldOptions extends BaseFieldOptions {
    /** Lazy target content type. */
    to: () => AnyContentType;
    /** Many-to-many via a generated join table. Defaults to false. */
    many?: boolean;
    /** FK referential action. Defaults to 'set null' (or 'cascade' when required). */
    onDelete?: RelationOnDelete;
    /**
     * One-to-one: add a `UNIQUE` constraint to the single FK column. Defaults
     * to false. Invalid with `many: true` (rejected at define time).
     */
    unique?: boolean;
    /**
     * Propagate this link to the record's other locale rows when it is edited
     * in one of them. Defaults to `true` (to `false` when `localized: true`).
     * Meaningful only on an `i18n` type — rejected at define time otherwise.
     * @see RelationSpec.syncAcrossLocales
     */
    syncAcrossLocales?: boolean;
}

/**
 * Options for `field.relationInverse()` — the back-reference side of a two-way
 * relation. It stores nothing: it mirrors the link owned by `of`'s `field`.
 */
export interface RelationInverseFieldOptions extends BaseFieldOptions {
    /** Lazy owning content type — the side that declares the storage-backed relation. */
    of: () => AnyContentType;
    /** The relation field name on `of` whose link this side mirrors. */
    field: string;
    /**
     * Whether this side is to-many. Defaults to `true` (the common inverse — the
     * "one"/"far" side of a to-many or many-to-many owns many back-references).
     */
    many?: boolean;
}

/**
 * The normalized field description every builder returns.
 *
 * `TValue` is a phantom type — it exists only so `InferEntry` can derive
 * the row type of a collection; nothing is stored in it at runtime.
 */
export interface FieldSpec<
    TType extends FieldType = FieldType,
    TValue = unknown
> {
    readonly type: TType;
    readonly required: boolean;
    /** Value differs per locale — set only on fields of `i18n` types. */
    readonly localized?: boolean;
    /** BCP-47 language of this field's content, when it has its own. */
    readonly lang?: string;
    readonly validation: FieldValidation;
    readonly admin: AdminProps;
    /** Allowed values — select fields only. */
    readonly options?: readonly string[];
    /** Relation config — relation fields only. */
    readonly relation?: RelationSpec;
    /** Holds an ordered list of asset ids — media fields only. */
    readonly multiple?: boolean;
    /** Accepted-asset restriction — media fields only. */
    readonly accept?: MediaAccept;
    /** Phantom compile-time value type. Never assigned. */
    readonly _value?: TValue;
}

/** Any field spec, regardless of type/value. */
export type AnyFieldSpec = FieldSpec<FieldType, unknown>;

/** Value type of a field spec (null-aware via `required`). */
export type FieldValue<F> = F extends FieldSpec<FieldType, infer V> ? V : never;

/** Maps an options object to `V` when `required: true`, else `V | null`. */
export type WithRequired<O, V> = O extends { required: true } ? V : V | null;
