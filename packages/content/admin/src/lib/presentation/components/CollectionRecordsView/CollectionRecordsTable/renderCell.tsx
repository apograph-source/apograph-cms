import type { ReactNode } from 'react';
import { defineMessages, type IntlShape } from 'react-intl';
import { FileText } from 'lucide-react';
import { Badge } from '@orthacms/design-system';
import type { ContentField } from '../../../../domain/types/contentType';
import { CONTENT_FIELD_TYPE } from '../../../../domain/constants';
import { richTextExcerpt } from '../../../../domain/richTextExcerpt';

/** Intl descriptors for the value renderings that are the cell's own words. */
const messages = defineMessages({
    booleanTrue: { id: 'content.cell.booleanTrue', defaultMessage: 'Yes' },
    booleanFalse: { id: 'content.cell.booleanFalse', defaultMessage: 'No' }
});

/** The em-dash placeholder for an empty cell. */
const EMPTY = '—';

/** True for a null/undefined/blank value. */
function isEmpty(value: unknown): boolean {
    return value == null || value === '';
}

/**
 * Render one field value into a table cell, by field type: scalars inline
 * (truncated), `boolean`/`select`/`status` as badges, dates via the intl
 * formatter, relations as a label with a `+N` overflow, `json` as a muted,
 * iconified summary, and `richtext` as a plain-text excerpt of its document
 * (the tree itself doesn't fit — or read as — a cell). An empty value renders a
 * muted em-dash. `intl` is passed in so the function stays a pure renderer (no
 * hook).
 */
export function renderCell(
    field: ContentField,
    value: unknown,
    intl: IntlShape
): ReactNode {
    if (isEmpty(value)) {
        return <span className="text-muted-foreground">{EMPTY}</span>;
    }

    switch (field.type) {
        case CONTENT_FIELD_TYPE.Boolean:
            // `String(value)` printed the literal English `true`/`false` — the
            // one place in the package a user-visible string bypassed intl, and
            // it read as a wire value rather than an answer. The editor's own
            // control already says Enabled/Disabled; a *cell* is a statement
            // about the record, so it says Yes/No.
            return (
                <Badge variant={value ? 'default' : 'secondary'}>
                    {intl.formatMessage(
                        value ? messages.booleanTrue : messages.booleanFalse
                    )}
                </Badge>
            );
        case CONTENT_FIELD_TYPE.Select:
            return <Badge variant="secondary">{String(value)}</Badge>;
        case CONTENT_FIELD_TYPE.Multiselect: {
            const items = Array.isArray(value) ? value : [value];
            return (
                <span className="inline-flex flex-wrap items-center gap-1">
                    {items.map((item) => (
                        <Badge key={String(item)} variant="secondary">
                            {String(item)}
                        </Badge>
                    ))}
                </span>
            );
        }
        case CONTENT_FIELD_TYPE.Date:
            return (
                <span className="text-muted-foreground">
                    {intl.formatDate(String(value), { dateStyle: 'medium' })}
                </span>
            );
        case CONTENT_FIELD_TYPE.Datetime:
            return (
                <span className="text-muted-foreground">
                    {intl.formatDate(String(value), {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                    })}
                </span>
            );
        case CONTENT_FIELD_TYPE.Money:
            // Minor units → major, at the kernel's fixed scale of 2. Rendered
            // as a **number**, not a currency: a `money` field carries no
            // currency member (see `content-domain`'s validate-entry-values),
            // so `style: 'currency', currency: 'USD'` was the admin inventing
            // one — every non-USD deployment read its own prices with a dollar
            // sign in front. An unlabelled amount is honest; a wrong label is
            // not. Restoring the symbol needs a currency on the field spec.
            return intl.formatNumber(Number(value) / 100, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        case CONTENT_FIELD_TYPE.Number:
            return intl.formatNumber(Number(value));
        case CONTENT_FIELD_TYPE.Relation: {
            if (Array.isArray(value)) {
                const [first, ...rest] = value;
                return (
                    <span className="inline-flex items-center gap-1">
                        <span className="truncate">{String(first)}</span>
                        {rest.length > 0 ? (
                            <Badge variant="secondary">+{rest.length}</Badge>
                        ) : null}
                    </span>
                );
            }
            return <span className="truncate">{String(value)}</span>;
        }
        case CONTENT_FIELD_TYPE.Json:
            return (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <FileText className="size-4" aria-hidden />
                    <span className="max-w-[24ch] truncate font-mono text-xs">
                        {JSON.stringify(value)}
                    </span>
                </span>
            );
        case CONTENT_FIELD_TYPE.RichText: {
            // Rich text is a document (or, for a body not yet re-saved, the
            // HTML string it used to be): printed raw, the cell shows the
            // reader their node tree or their markup instead of their
            // sentence. Excerpt it to the words, and treat "structure with no
            // words" (an empty paragraph) as empty — `isEmpty` above can't see
            // that, since neither an object nor `<p></p>` is blank.
            const text = richTextExcerpt(value);
            if (text === '')
                return <span className="text-muted-foreground">{EMPTY}</span>;
            return <span className="block max-w-[28ch] truncate">{text}</span>;
        }
        case CONTENT_FIELD_TYPE.Text:
        default:
            return (
                <span className="block max-w-[28ch] truncate">
                    {String(value)}
                </span>
            );
    }
}
