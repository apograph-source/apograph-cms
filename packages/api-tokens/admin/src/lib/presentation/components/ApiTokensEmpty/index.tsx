import { defineMessages, useIntl } from 'react-intl';
import { KeyRound, Plus } from 'lucide-react';
import { Button } from '@orthacms/design-system';

const messages = defineMessages({
    title: {
        id: 'apiTokens.empty.title',
        defaultMessage: 'No API tokens yet'
    },
    description: {
        id: 'apiTokens.empty.description',
        defaultMessage:
            'Create a bearer token to let an external app read content through the API.'
    },
    create: {
        id: 'apiTokens.empty.create',
        defaultMessage: 'New token'
    }
});

/** The empty state: no tokens exist yet. Offers the create action when allowed. */
export function ApiTokensEmpty({ onCreate }: { onCreate?: () => void }) {
    const intl = useIntl();
    return (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <KeyRound className="size-10 text-muted-foreground" aria-hidden />
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
