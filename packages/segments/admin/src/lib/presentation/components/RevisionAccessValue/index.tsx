import { defineMessages, useIntl } from 'react-intl';
import { Globe, Lock } from 'lucide-react';
import type { RevisionExtraValueContext } from '@orthacms/content-admin';
import { Badge } from '@orthacms/design-system';
import { useSegmentLookup } from '../../../application/hooks';
import type { EntryAccess } from '../../../domain/types';

const messages = defineMessages({
    open: {
        id: 'segments.revision.open',
        defaultMessage: 'Readable by everyone'
    },
    unknown: {
        id: 'segments.revision.unknown',
        defaultMessage: 'Not recorded in this version'
    },
    allow: { id: 'segments.revision.allow', defaultMessage: 'Can see' },
    deny: { id: 'segments.revision.deny', defaultMessage: 'Cannot see' },
    gone: { id: 'segments.revision.gone', defaultMessage: 'Deleted audience' }
});

/** The two lists, if that is what the version recorded. */
function parse(value: unknown): EntryAccess | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const bag = value as Partial<EntryAccess>;
    return {
        allow: Array.isArray(bag.allow) ? bag.allow : [],
        deny: Array.isArray(bag.deny) ? bag.deny : []
    };
}

/**
 * One side of the revision preview's **Access** row — who could read the entry
 * when that version was captured.
 *
 * Three states, and the third is the one worth getting right. A version that
 * recorded a bag shows it; a version that recorded **nothing** because the entry
 * was unrestricted says so; a version captured before this plugin existed says
 * *"not recorded"* — because a restore leaves an unmentioned key alone, and
 * printing "readable by everyone" there would promise a change the restore will
 * not make.
 *
 * Segments are named by their **current** label, resolved from the directory. An
 * audience deleted since is a muted placeholder rather than a raw uuid: the id
 * is all the version holds, and it has no meaning left to show.
 */
export function RevisionAccessValue({ value }: RevisionExtraValueContext) {
    const intl = useIntl();
    const access = parse(value);
    // Resolved **by id**, not from a page of the directory. The directory is
    // paginated, so an audience a version captured is as likely to be on page
    // three as on page one — and a miss there would render as "deleted
    // audience", which is a claim rather than a gap.
    const segments = useSegmentLookup([
        ...(access?.allow ?? []),
        ...(access?.deny ?? [])
    ]);

    if (value === undefined) {
        return (
            <span className="text-muted-foreground">
                {intl.formatMessage(messages.unknown)}
            </span>
        );
    }

    if (!access || (!access.allow.length && !access.deny.length)) {
        return (
            <span className="inline-flex items-center gap-1.5">
                <Globe className="size-3.5 text-muted-foreground" aria-hidden />
                {intl.formatMessage(messages.open)}
            </span>
        );
    }

    const labelFor = (id: string) =>
        segments.data?.find((segment) => segment.id === id)?.label ??
        intl.formatMessage(messages.gone);

    const list = (ids: string[], kind: 'allow' | 'deny') =>
        ids.length ? (
            <div key={kind} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages[kind])}
                </span>
                {ids.map((id) => (
                    <Badge
                        key={id}
                        variant={kind === 'allow' ? 'secondary' : 'warning'}
                    >
                        {kind === 'deny' ? (
                            <Lock className="size-3" aria-hidden />
                        ) : null}
                        {labelFor(id)}
                    </Badge>
                ))}
            </div>
        ) : null;

    return (
        <div className="flex flex-col gap-1.5">
            {list(access.allow, 'allow')}
            {list(access.deny, 'deny')}
        </div>
    );
}
