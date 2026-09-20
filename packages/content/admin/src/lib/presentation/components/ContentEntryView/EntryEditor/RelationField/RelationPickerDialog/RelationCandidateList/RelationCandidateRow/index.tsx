import { defineMessages, useIntl } from 'react-intl';
import { ExternalLink } from 'lucide-react';
import { Badge, Checkbox, buttonVariants, cn } from '@orthacms/design-system';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type { RelationCandidate } from '../../../../../../../../application/useRelationCandidates';
import { contentEntryPath } from '../../../../../../../../domain/contentEntryPath';

const messages = defineMessages({
    open: {
        id: 'content.relations.candidate.open',
        defaultMessage: 'Open {title} in a new tab'
    }
});

/** Secondary line for a candidate row, e.g. `tag · b2e3d4c5`. */
function meta(targetName: string, id: string): string {
    return `${targetName} · ${id.slice(0, 8)}`;
}

/**
 * One selectable candidate in the {@link RelationCandidateList}: an accessible
 * checkbox (many-relation) or radio (single) whose label is the record's title +
 * a muted meta line, plus an optional status badge. Presentational — the parent
 * owns selection state and `onPick`.
 */
export function RelationCandidateRow({
    candidate,
    many,
    checked,
    isSelected,
    targetName,
    onPick
}: {
    candidate: RelationCandidate;
    many: boolean;
    /** Whether this row is staged (many-relation). */
    checked: boolean;
    /** Whether this row is the current pick (single relation). */
    isSelected: boolean;
    targetName: string;
    onPick: () => void;
}) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const active = many ? checked : isSelected;
    return (
        <label
            className={`flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring ${
                active
                    ? 'border-l-primary bg-primary/5'
                    : 'border-l-transparent hover:bg-accent'
            }`}
        >
            {many ? (
                // The design-system Checkbox is a Radix button (role="checkbox"),
                // not a native input — the wrapping <label> doesn't name it, so
                // label it explicitly with the record title.
                <Checkbox
                    checked={checked}
                    onCheckedChange={onPick}
                    aria-label={candidate.title}
                />
            ) : (
                <input
                    type="radio"
                    name={`relation-candidate-${targetName}`}
                    className="size-4 shrink-0 accent-primary"
                    checked={isSelected}
                    onChange={onPick}
                />
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                    {candidate.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {meta(targetName, candidate.id)}
                </span>
            </span>
            {candidate.status ? (
                <Badge variant="outline" className="shrink-0 capitalize">
                    {candidate.status}
                </Badge>
            ) : null}
            {/* An interactive descendant of the <label>: clicking it opens the
                record in a new tab and does NOT toggle the selection control. */}
            <a
                href={contentEntryPath(workspace.id, targetName, candidate.id)}
                target="_blank"
                rel="noreferrer"
                className={cn(
                    buttonVariants({ variant: 'ghost', size: 'icon' }),
                    'size-7 shrink-0 text-muted-foreground hover:text-foreground'
                )}
                aria-label={intl.formatMessage(messages.open, {
                    title: candidate.title
                })}
            >
                <ExternalLink className="size-4" aria-hidden />
            </a>
        </label>
    );
}
