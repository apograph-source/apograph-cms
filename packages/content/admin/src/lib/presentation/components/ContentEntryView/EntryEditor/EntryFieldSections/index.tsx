import { defineMessages, useIntl } from 'react-intl';
import { Separator } from '@orthacms/design-system';
import type { ContentField } from '../../../../../domain/types/contentType';
import { CONTENT_FIELD_TYPE } from '../../../../../domain/constants';
import type { EntryFormState } from '../../../../hooks/useEntryForm';
import { EntryFieldInput } from '../../../EntryFieldInput';
import { FieldGroup } from './FieldGroup';

const messages = defineMessages({
    translatedTitle: {
        id: 'content.form.group.translatedTitle',
        defaultMessage: 'Translated fields'
    },
    translatedBody: {
        id: 'content.form.group.translatedBody',
        defaultMessage: 'These hold a different value in each locale.'
    },
    sharedTitle: {
        id: 'content.form.group.sharedTitle',
        defaultMessage: 'Shared fields'
    },
    sharedBody: {
        id: 'content.form.group.sharedBody',
        defaultMessage:
            'These are the same in every locale — editing one here changes it everywhere.'
    },
    sharedPrefilled: {
        id: 'content.form.group.sharedPrefilled',
        defaultMessage:
            'These were copied from the {locale} version and are still written in that language. Translate them here and they change in every locale.'
    },
    requiredLegend: {
        id: 'content.form.requiredLegend',
        defaultMessage:
            'Fields marked * are required before this entry can be published.'
    }
});

/**
 * States what the `*` beside a field label means, once, above the fields.
 *
 * `RequiredMark` used to say it in a native `title` on an `aria-hidden` span —
 * mouse-only, not dismissible, and unreachable by assistive tech (`ORT-90`).
 * A form-wide convention belongs to the form, not to each of its labels: said
 * here it is visible to everyone, announced once instead of on every field, and
 * there is nothing to hover.
 *
 * Rendered only when something on screen is actually marked.
 */
function RequiredLegend({ fields }: { fields: ContentField[] }) {
    const intl = useIntl();
    if (!fields.some((field) => field.required)) return null;

    return (
        <p className="text-muted-foreground text-xs">
            {intl.formatMessage(messages.requiredLegend)}
        </p>
    );
}

/**
 * Field ordering, by control shape. Fields flow top-to-bottom in three tiers
 * by rank:
 *   0 — simple inputs (text, number, money, date, datetime)
 *   1 — choice controls (select, boolean, multi-select)
 *   2 — large fields (rich text, JSON)
 * Types not listed fall to the bottom — a safe default for any new field type.
 */
const FIELD_RANK: Record<string, number> = {
    [CONTENT_FIELD_TYPE.Text]: 0,
    [CONTENT_FIELD_TYPE.Number]: 0,
    [CONTENT_FIELD_TYPE.Money]: 0,
    [CONTENT_FIELD_TYPE.Date]: 0,
    [CONTENT_FIELD_TYPE.Datetime]: 0,
    [CONTENT_FIELD_TYPE.Select]: 1,
    [CONTENT_FIELD_TYPE.Boolean]: 1,
    [CONTENT_FIELD_TYPE.Multiselect]: 1,
    [CONTENT_FIELD_TYPE.RichText]: 2,
    [CONTENT_FIELD_TYPE.Json]: 2
};

const DEFAULT_RANK = 3;

const rankFor = (type: string) => FIELD_RANK[type] ?? DEFAULT_RANK;

/**
 * The General tab body: every editable field in **one** flush block (no card
 * chrome — no border, background, or padding), ordered top-to-bottom by
 * control shape — simple inputs (text, number, dates) first, then choice
 * controls (select, boolean, multi-select), then the large fields (rich text,
 * JSON) last. No section headers: the order alone groups like with like. One
 * field per row — a single stacked column the user works through step by step.
 * Relation fields are handled by their own tab and excluded by the caller.
 */
export function EntryFieldSections({
    fields,
    form,
    isChanged,
    contentLocale,
    prefilledFromLocale
}: {
    fields: ContentField[];
    form: EntryFormState;
    /** Whether a field has unsaved edits (drives its "Changed" badge). */
    isChanged?: (name: string) => boolean;
    /**
     * BCP-47 tag of the locale a translation prefill copied the **shared**
     * values from — set only on a create seeded that way. Marks and explains
     * that run; see the comment at its call site (`ORT-87`).
     */
    prefilledFromLocale?: string;
    /**
     * The row's own locale, on a localized type — a **BCP-47 language tag** by
     * the i18n plugin's wire contract, so it goes on the translated group
     * verbatim as `lang`.
     *
     * Without it every locale's content sat inside the admin's hardcoded
     * `<html lang="en">`, and a screen reader read German, French and Arabic
     * prose with English pronunciation rules — the most audible failure a
     * localization tool can have (WCAG 3.1.2).
     */
    contentLocale?: string;
}) {
    const intl = useIntl();
    const ordered = [...fields].sort(
        (a, b) => rankFor(a.type) - rankFor(b.type)
    );

    if (ordered.length === 0) return null;

    // On a localized type, per-locale and shared fields behave very differently
    // on save — editing a shared field changes it for *every* locale — so they
    // are split into two labelled runs rather than interleaved. Only i18n types
    // ever mark a field `localized`, so a plain type keeps the flat, header-free
    // layout below and is untouched by this.
    const translated = ordered.filter((field) => field.localized);
    const shared = ordered.filter((field) => !field.localized);

    if (translated.length === 0 || shared.length === 0) {
        return (
            <div className="flex flex-col gap-5">
                <RequiredLegend fields={ordered} />
                {ordered.map((field) => (
                    <EntryFieldInput
                        key={field.name}
                        field={field}
                        value={form.values[field.name]}
                        error={form.errorFor(field.name)}
                        changed={isChanged?.(field.name) ?? false}
                        onChange={(value) => form.setValue(field.name, value)}
                        onBlur={() => form.touch(field.name)}
                    />
                ))}
            </div>
        );
    }

    return (
        // `gap-6` rather than the `gap-8` this used before the rule: the gap is
        // now paid **twice** (group → rule → group), so keeping 8 would have
        // doubled the whitespace between the runs. Six leaves the rule centred
        // between them and still clear of the `gap-5` between fields inside a
        // group, so the stronger break reads as the group boundary.
        <div className="flex flex-col gap-6">
            <RequiredLegend fields={ordered} />
            {/* Only the translated run carries the row's language: by
                definition it holds this locale's text. A shared field holds one
                value for every locale — usually still in the language it was
                first written in — so claiming this locale for it would be a
                worse assertion than making none. Both runs get `dir="auto"`,
                which orders each field's own bidi text from its content rather
                than from the admin's chrome. */}
            <FieldGroup
                title={intl.formatMessage(messages.translatedTitle)}
                description={intl.formatMessage(messages.translatedBody)}
                fields={translated}
                form={form}
                isChanged={isChanged}
                lang={contentLocale}
                dir="auto"
            />
            {/* The boundary between the two runs, drawn rather than left to
                whitespace: which run a field is in decides whether editing it
                changes every locale, and a gap alone did not say where one run
                ended. Deliberately **decorative** — Radix renders `role="none"`,
                so it adds nothing to the accessibility tree; the two group
                headings are what name the runs for a screen reader, and a rule
                announced as content would only be noise between them. */}
            <Separator data-testid="entry-field-group-divider" />
            {/* The shared run carries `lang` **only** on a fresh translation
                prefill. #146 deliberately left it unmarked in general, and that
                is right: a shared field holds one value for every locale, so
                claiming this row's locale for it would be a worse assertion
                than making none. A prefill is the one moment the language *is*
                known — the values were copied verbatim from another row
                seconds ago — so it is marked and said out loud (WCAG 3.1.2,
                508 504.3 — `ORT-87`). It stops being true the moment the
                author edits or saves, which is why nothing persists it. */}
            <FieldGroup
                title={intl.formatMessage(messages.sharedTitle)}
                description={
                    prefilledFromLocale
                        ? intl.formatMessage(messages.sharedPrefilled, {
                              locale: prefilledFromLocale
                          })
                        : intl.formatMessage(messages.sharedBody)
                }
                fields={shared}
                form={form}
                isChanged={isChanged}
                {...(prefilledFromLocale ? { lang: prefilledFromLocale } : {})}
                dir="auto"
            />
        </div>
    );
}
