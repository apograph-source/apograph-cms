import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@orthacms/design-system';
import {
    IMPORT_ACTION,
    IMPORT_REASON,
    type ImportAction,
    type ImportReason,
    type ImportVerdict
} from '@orthacms/transfer-domain';

const messages = defineMessages({
    record: { id: 'transfer.import.column.record', defaultMessage: 'Record' },
    type: { id: 'transfer.import.column.type', defaultMessage: 'Type' },
    outcome: {
        id: 'transfer.import.column.outcome',
        defaultMessage: 'What happens'
    },
    actionCreate: {
        id: 'transfer.import.action.create',
        defaultMessage: 'Create'
    },
    actionUpdate: {
        id: 'transfer.import.action.update',
        defaultMessage: 'Update'
    },
    actionSkip: { id: 'transfer.import.action.skip', defaultMessage: 'Skip' },
    actionError: {
        id: 'transfer.import.action.error',
        defaultMessage: 'Problem'
    },
    reasonNew: {
        id: 'transfer.import.reason.new',
        defaultMessage: 'Nothing here matches it yet'
    },
    reasonMatched: {
        id: 'transfer.import.reason.matched',
        defaultMessage: 'Matches an existing record'
    },
    reasonConflictSkipped: {
        id: 'transfer.import.reason.conflictSkipped',
        defaultMessage: 'Already here — left untouched'
    },
    reasonConflictDuplicated: {
        id: 'transfer.import.reason.conflictDuplicated',
        defaultMessage: 'Already here — a second copy will be added'
    },
    reasonRelationLinked: {
        id: 'transfer.import.reason.relationLinked',
        defaultMessage: 'Already here — your records will link to it'
    },
    reasonRelationRecreated: {
        id: 'transfer.import.reason.relationRecreated',
        defaultMessage: 'Already here — a new copy will be added and linked to'
    },
    reasonNoIdentity: {
        id: 'transfer.import.reason.noIdentity',
        defaultMessage:
            'This type has no field to match on, so it can only be added'
    },
    reasonUnknownType: {
        id: 'transfer.import.reason.unknownType',
        defaultMessage: 'This installation has no such content type'
    },
    reasonUnknownField: {
        id: 'transfer.import.reason.unknownField',
        defaultMessage: 'The file names a field this type doesn’t have'
    },
    reasonValidationFailed: {
        id: 'transfer.import.reason.validationFailed',
        defaultMessage: 'The values were rejected'
    },
    reasonUnresolvedRelations: {
        id: 'transfer.import.reason.unresolvedRelations',
        defaultMessage: 'Some links point at records that aren’t here'
    },
    reasonDependencyFailed: {
        id: 'transfer.import.reason.dependencyFailed',
        defaultMessage: 'Something it depends on failed'
    },
    reasonMissingAsset: {
        id: 'transfer.import.reason.missingAsset',
        defaultMessage: 'A file it references isn’t in the archive'
    },
    reasonForbidden: {
        id: 'transfer.import.reason.forbidden',
        defaultMessage: 'You don’t have permission for this change'
    },
    unresolved: {
        id: 'transfer.import.unresolved',
        defaultMessage:
            'Links not found: {refs}. They’ll be left empty and everything else still imports.'
    },
    truncated: {
        id: 'transfer.import.truncated',
        defaultMessage:
            'Showing the first {shown} of {total}. The rest follow the same rules.'
    }
});

const ACTION_LABEL: Record<ImportAction, (typeof messages)['actionCreate']> = {
    [IMPORT_ACTION.Create]: messages.actionCreate,
    [IMPORT_ACTION.Update]: messages.actionUpdate,
    [IMPORT_ACTION.Skip]: messages.actionSkip,
    [IMPORT_ACTION.Error]: messages.actionError
};

const REASON_LABEL: Record<ImportReason, (typeof messages)['reasonNew']> = {
    [IMPORT_REASON.New]: messages.reasonNew,
    [IMPORT_REASON.Matched]: messages.reasonMatched,
    [IMPORT_REASON.ConflictSkipped]: messages.reasonConflictSkipped,
    [IMPORT_REASON.ConflictDuplicated]: messages.reasonConflictDuplicated,
    [IMPORT_REASON.RelationLinked]: messages.reasonRelationLinked,
    [IMPORT_REASON.RelationRecreated]: messages.reasonRelationRecreated,
    [IMPORT_REASON.NoIdentity]: messages.reasonNoIdentity,
    [IMPORT_REASON.UnknownType]: messages.reasonUnknownType,
    [IMPORT_REASON.UnknownField]: messages.reasonUnknownField,
    [IMPORT_REASON.ValidationFailed]: messages.reasonValidationFailed,
    [IMPORT_REASON.UnresolvedRelations]: messages.reasonUnresolvedRelations,
    [IMPORT_REASON.DependencyFailed]: messages.reasonDependencyFailed,
    [IMPORT_REASON.MissingAsset]: messages.reasonMissingAsset,
    [IMPORT_REASON.Forbidden]: messages.reasonForbidden
};

/** How the action reads at a glance — state in form, not only in words. */
const ACTION_VARIANT: Record<
    ImportAction,
    'default' | 'secondary' | 'outline' | 'destructive'
> = {
    [IMPORT_ACTION.Create]: 'default',
    [IMPORT_ACTION.Update]: 'secondary',
    [IMPORT_ACTION.Skip]: 'outline',
    [IMPORT_ACTION.Error]: 'destructive'
};

/**
 * How many rows are listed.
 *
 * A five-thousand-row file would otherwise render five thousand table rows into
 * a dialog, which is slow and unreadable in equal measure. The counts above the
 * table are the summary; this list is for spotting the shape of the run and the
 * problems in it, so the errors are floated to the top rather than paged.
 */
const MAX_ROWS = 100;

/** The dry run's per-record verdicts, problems first. */
export function ImportVerdictList({
    verdicts
}: {
    verdicts: readonly ImportVerdict[];
}) {
    const intl = useIntl();

    // Errors first, then skips, then the writes — a reader scanning this is
    // looking for what will go wrong, not for confirmation that most of it is
    // fine. Stable within each group, so the file's own order still shows.
    const rank: Record<ImportAction, number> = {
        [IMPORT_ACTION.Error]: 0,
        [IMPORT_ACTION.Skip]: 1,
        [IMPORT_ACTION.Update]: 2,
        [IMPORT_ACTION.Create]: 3
    };
    const ordered = [...verdicts].sort(
        (a, b) => rank[a.action] - rank[b.action]
    );
    const shown = ordered.slice(0, MAX_ROWS);

    return (
        <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
                <TableHeader className="bg-background sticky top-0">
                    <TableRow>
                        <TableHead>
                            {intl.formatMessage(messages.record)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.type)}
                        </TableHead>
                        <TableHead>
                            {intl.formatMessage(messages.outcome)}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {shown.map((verdict) => (
                        <TableRow key={`${verdict.$type}:${verdict.$id}`}>
                            <TableCell className="font-medium">
                                {verdict.label}
                                {verdict.locale ? (
                                    <span className="text-muted-foreground ml-1.5 text-xs uppercase">
                                        {verdict.locale}
                                    </span>
                                ) : null}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                                {verdict.$type}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-col gap-1">
                                    <span className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                ACTION_VARIANT[verdict.action]
                                            }
                                        >
                                            {intl.formatMessage(
                                                ACTION_LABEL[verdict.action]
                                            )}
                                        </Badge>
                                        <span className="text-muted-foreground text-sm">
                                            {intl.formatMessage(
                                                REASON_LABEL[verdict.reason]
                                            )}
                                        </span>
                                    </span>
                                    {verdict.issues?.length ? (
                                        <span className="text-destructive text-xs">
                                            {verdict.issues.join('; ')}
                                        </span>
                                    ) : null}
                                    {verdict.unresolved?.length ? (
                                        <span className="text-muted-foreground text-xs">
                                            {intl.formatMessage(
                                                messages.unresolved,
                                                {
                                                    refs: verdict.unresolved.join(
                                                        ', '
                                                    )
                                                }
                                            )}
                                        </span>
                                    ) : null}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {ordered.length > shown.length ? (
                <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                    {intl.formatMessage(messages.truncated, {
                        shown: shown.length,
                        total: ordered.length
                    })}
                </p>
            ) : null}
        </div>
    );
}
