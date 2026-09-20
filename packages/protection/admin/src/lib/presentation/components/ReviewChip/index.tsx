import { defineMessages, useIntl } from 'react-intl';
import { ShieldCheck } from 'lucide-react';
import type { EntrySlotContext } from '@orthacms/content-admin';
import { Badge } from '@orthacms/design-system';
import { toneOf } from '../../../domain/types';
import { reviewScopeOf, useEntryReview } from '../../../application/hooks';

const messages = defineMessages({
    needsReview: {
        id: 'protection.chip.needsReview',
        defaultMessage: 'Needs review · {given} of {required}'
    },
    ready: {
        id: 'protection.chip.ready',
        defaultMessage: 'Reviewed · {given} of {required}'
    },
    title: {
        id: 'protection.chip.title',
        defaultMessage:
            'This type requires {required, plural, one {# approval} other {# approvals}} before it can be published — see Review in the properties panel'
    }
});

/**
 * The entry header's review chip.
 *
 * It sits beside the title, next to the status badge, because the moment the
 * requirement matters is the moment somebody is about to press Publish — and
 * that is a moment spent looking at the title, not auditing the rail.
 *
 * It renders **nothing** on an unprotected type. With no rule the feature is
 * inert server-side, and a chip claiming anything about review would describe a
 * gate that is not there.
 *
 * The label carries the count in **text**, so the tone is a second signal
 * rather than the only one: "Needs review · 0 of 2" reads the same to somebody
 * who cannot tell the destructive tone from the success one.
 */
export function ReviewChip(context: EntrySlotContext) {
    const intl = useIntl();
    const scope = reviewScopeOf(context);
    const { data } = useEntryReview(scope);

    // No rule, still loading, or nothing to review: say nothing. A chip that
    // appeared a beat after the title would move the heading under the reader.
    if (!data?.protected) return null;

    const tone = toneOf(data);
    const values = { given: data.given, required: data.required };

    return (
        <Badge
            variant={
                tone === 'satisfied'
                    ? 'success'
                    : tone === 'partial'
                      ? 'warning'
                      : 'destructive-soft'
            }
            title={intl.formatMessage(messages.title, {
                required: data.required
            })}
        >
            <ShieldCheck aria-hidden className="size-3" />
            {intl.formatMessage(
                tone === 'satisfied' ? messages.ready : messages.needsReview,
                values
            )}
        </Badge>
    );
}
