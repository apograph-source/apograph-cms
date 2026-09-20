import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Button } from '@orthacms/design-system';
import type { RecordsToolbarContext } from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { BellPlus } from 'lucide-react';
import { SaveFilterAsRuleDialog } from './SaveFilterAsRuleDialog';

const messages = defineMessages({
    save: { id: 'alarms.saveAsRule.save', defaultMessage: 'Save as alarm' },
    label: {
        id: 'alarms.saveAsRule.label',
        defaultMessage: 'Watch for the records this filter matches'
    }
});

/**
 * "Save as alarm" in the records toolbar — the feature's main entrance.
 *
 * Nobody arrives at alarms by deciding to write a rule. They filter a list
 * because something looks wrong, see the fourteen records, and want the CMS to
 * keep an eye on them. At that moment the condition is already built and already
 * verified by eye, so the only thing left is to name it.
 *
 * The filter is read straight off the URL. `RecordsToolbarContext.params`
 * carries only the keys an item **declares** as its own, and `?filter=` belongs
 * to content's own filter control — so this reads the query string rather than
 * claiming ownership of a param it does not own and having its value forwarded
 * to the records request twice.
 */
export function SaveFilterAsRuleAction({ schema }: RecordsToolbarContext) {
    const intl = useIntl();
    const canManage = useHasPermission('alarms:manage');
    const [searchParams] = useSearchParams();
    const [open, setOpen] = useState(false);

    const rawFilter = searchParams.get('filter');

    // Nothing to save without a filter, and no permission means no rules. Both
    // hide the button rather than disabling it: a disabled control with no
    // explanation is a worse answer than an absent one.
    if (!canManage || !rawFilter) return null;

    return (
        <>
            {/* Sized and styled like the controls it stands beside — the
                column picker and the Filters toggle are default-size outline
                buttons with `shadow-none`. This carried `size="sm"` and kept
                its shadow, so it read as a different class of control wedged
                into their row. */}
            <Button
                variant="outline"
                className="shadow-none"
                onClick={() => setOpen(true)}
                aria-label={intl.formatMessage(messages.label)}
            >
                <BellPlus aria-hidden className="size-4" />
                {intl.formatMessage(messages.save)}
            </Button>
            {/* Kept mounted and driven by state — a dialog rendered inside a
                menu unmounts exactly when it is meant to appear. */}
            <SaveFilterAsRuleDialog
                open={open}
                onOpenChange={setOpen}
                contentType={schema.name}
                rawFilter={rawFilter}
            />
        </>
    );
}
