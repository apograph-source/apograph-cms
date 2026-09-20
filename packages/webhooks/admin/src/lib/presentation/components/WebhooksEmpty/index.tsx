import { defineMessages, useIntl } from 'react-intl';
import { Plus, Webhook } from 'lucide-react';
import { Button } from '@orthacms/design-system';

const messages = defineMessages({
    title: {
        id: 'webhooks.empty.title',
        defaultMessage: 'No webhooks yet'
    },
    description: {
        id: 'webhooks.empty.description',
        defaultMessage:
            'Add an endpoint to have this CMS notify another system when content changes — a site rebuild, a cache purge, a search re-index.'
    },
    create: {
        id: 'webhooks.empty.create',
        defaultMessage: 'New webhook'
    }
});

/** The empty state: nothing is configured yet. Offers the create action when allowed. */
export function WebhooksEmpty({ onCreate }: { onCreate?: () => void }) {
    const intl = useIntl();
    return (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <Webhook className="size-10 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-medium">
                {intl.formatMessage(messages.title)}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
                {intl.formatMessage(messages.description)}
            </p>
            {onCreate ? (
                <Button className="mt-2" onClick={onCreate}>
                    <Plus />
                    {intl.formatMessage(messages.create)}
                </Button>
            ) : null}
        </div>
    );
}
