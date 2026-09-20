import { defineMessages, useIntl } from 'react-intl';
import { FileText, Layers, X } from 'lucide-react';
import { Badge, Button } from '@orthacms/design-system';
import type { ContentType } from '../../../../domain/types/wizard';
import { isPage } from '..';

const messages = defineMessages({
    collection: {
        id: 'workspaces.settings.content.kindCollection',
        defaultMessage: 'Collection'
    },
    single: {
        id: 'workspaces.settings.content.kindSingle',
        defaultMessage: 'Page'
    },
    remove: {
        id: 'workspaces.settings.content.remove',
        defaultMessage: 'Remove {label}'
    }
});

/** A granted content type resolved for display: the slug plus its catalogue entry. */
export type GrantedContent = {
    /** The stored grant slug. */
    slug: string;
    /** The matching catalogue type, or `undefined` for a stale/unknown slug. */
    type?: ContentType;
};

/** Props for {@link GrantedContentRow}. */
export type GrantedContentRowProps = {
    /** The granted content to render. */
    granted: GrantedContent;
    /** Whether a remove control should be offered. */
    canRemove: boolean;
    /** Called when the remove control is pressed. */
    onRemove: () => void;
    /** Show the kind badge; off under a Collections/Pages group heading. */
    showKind?: boolean;
};

/**
 * One row in the granted-content list: an icon by kind, the type's label
 (falling back to the raw slug for an unknown type), a kind badge, and — when the
 * user may manage content — a remove button.
 */
export function GrantedContentRow({
    granted,
    canRemove,
    onRemove,
    showKind = true
}: GrantedContentRowProps) {
    const intl = useIntl();
    const { slug, type } = granted;
    const label = type?.label ?? type?.name ?? slug;
    const isCollection = !isPage(type);

    return (
        <div className="flex items-center gap-3 px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {isCollection ? (
                    <Layers className="size-4" />
                ) : (
                    <FileText className="size-4" />
                )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{label}</span>
                {type?.description ? (
                    <span className="truncate text-xs text-muted-foreground">
                        {type.description}
                    </span>
                ) : null}
            </div>
            {showKind ? (
                <Badge variant="secondary">
                    {intl.formatMessage(
                        isCollection ? messages.collection : messages.single
                    )}
                </Badge>
            ) : null}
            {canRemove ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onRemove}
                    aria-label={intl.formatMessage(messages.remove, { label })}
                >
                    <X className="size-4" />
                </Button>
            ) : null}
        </div>
    );
}
