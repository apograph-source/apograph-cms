import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    InputField,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    toast
} from '@orthacms/design-system';
import {
    useCreateAlarmRule,
    usePreviewAlarmRule
} from '../../../../application/useAlarmRuleMutations';
import { ALARM_SEVERITIES, type AlarmSeverity } from '../../../../types/alarm';

const messages = defineMessages({
    title: {
        id: 'alarms.saveDialog.title',
        defaultMessage: 'Save as alarm'
    },
    description: {
        id: 'alarms.saveDialog.description',
        defaultMessage:
            'The CMS will keep checking {contentType} against this filter and flag whatever matches. It never blocks a save or a publish.'
    },
    name: { id: 'alarms.saveDialog.name', defaultMessage: 'Alarm name' },
    nameHint: {
        id: 'alarms.saveDialog.nameHint',
        defaultMessage: 'How this alarm is listed. Must be unique.'
    },
    findingTitle: {
        id: 'alarms.saveDialog.findingTitle',
        defaultMessage: 'What editors will see'
    },
    findingHint: {
        id: 'alarms.saveDialog.findingHint',
        defaultMessage:
            'Shown on the record itself, so write it for whoever opens one: “Author is not published”.'
    },
    severity: { id: 'alarms.saveDialog.severity', defaultMessage: 'Level' },
    severityError: {
        id: 'alarms.saveDialog.severityError',
        defaultMessage: 'Error'
    },
    severityWarn: {
        id: 'alarms.saveDialog.severityWarn',
        defaultMessage: 'Warning'
    },
    severityInfo: {
        id: 'alarms.saveDialog.severityInfo',
        defaultMessage: 'Info'
    },
    matches: {
        id: 'alarms.saveDialog.matches',
        defaultMessage: 'Matches now: {matched} of {total}'
    },
    checking: {
        id: 'alarms.saveDialog.checking',
        defaultMessage: 'Counting matches…'
    },
    cancel: { id: 'alarms.saveDialog.cancel', defaultMessage: 'Cancel' },
    submit: {
        id: 'alarms.saveDialog.submit',
        defaultMessage: 'Save and check'
    },
    created: {
        id: 'alarms.saveDialog.created',
        defaultMessage:
            '{name} saved. {opened, plural, =0 {Nothing flagged} one {# record flagged} other {# records flagged}}.'
    },
    failed: {
        id: 'alarms.saveDialog.failed',
        defaultMessage: 'The alarm could not be saved: {reason}'
    },
    badFilter: {
        id: 'alarms.saveDialog.badFilter',
        defaultMessage:
            'This filter could not be read, so it cannot be saved as a rule.'
    }
});

/** Props for {@link SaveFilterAsRuleDialog}. */
export type SaveFilterAsRuleDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The content type the list is showing. */
    contentType: string;
    /** The raw `?filter=` JSON from the URL. */
    rawFilter: string;
};

/** The severity labels, keyed the same way the type is. */
const SEVERITY_LABELS = {
    error: messages.severityError,
    warn: messages.severityWarn,
    info: messages.severityInfo
} as const;

/**
 * Names a filter and turns it into a rule.
 *
 * Two fields that look redundant and are not: **rule name** is how the rule is
 * listed for whoever manages editorial policy; **what editors will see** is the
 * sentence that appears beside one article. Collapsing them produces either a
 * rule list full of instructions or an editor being told "Relations point at
 * published records" about the piece they are writing.
 *
 * The condition itself is shown nowhere and is not editable here — it was built
 * in the list the user is looking at, and re-presenting it would invite them to
 * check work they just did.
 */
export function SaveFilterAsRuleDialog({
    open,
    onOpenChange,
    contentType,
    rawFilter
}: SaveFilterAsRuleDialogProps) {
    const intl = useIntl();
    const [name, setName] = useState('');
    const [findingTitle, setFindingTitle] = useState('');
    const [severity, setSeverity] = useState<AlarmSeverity>('warn');

    const create = useCreateAlarmRule();
    const preview = usePreviewAlarmRule();

    /**
     * The URL's filter, parsed. `null` when it is not a JSON object.
     *
     * Taken verbatim, which has one consequence worth knowing: a list filtered
     * by "within the last N days" carries a **resolved** cutoff in its URL (the
     * query builder freezes it there so a shared link keeps showing the same
     * rows), so a rule saved from one is an absolute date range. Making it a
     * rolling window is a one-line edit in the rule editor, which serialises the
     * relative spelling — the URL simply has no way to say which of the two the
     * person meant.
     */
    const filter = useMemo<Record<string, unknown> | null>(() => {
        try {
            const parsed: unknown = JSON.parse(rawFilter);
            return parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : null;
        } catch {
            return null;
        }
    }, [rawFilter]);

    // Count the matches when the dialog opens, so the person naming the rule
    // sees the size of what they are about to watch. `preview.mutate` is stable
    // across renders, so the effect keys on what actually decides the answer.
    const previewMutate = preview.mutate;
    useEffect(() => {
        if (!open || !filter) return;
        previewMutate({ contentType, filter });
    }, [open, filter, contentType, previewMutate]);

    const submit = () => {
        if (!filter) return;
        create.mutate(
            {
                contentType,
                name: name.trim(),
                findingTitle: findingTitle.trim(),
                severity,
                filter
            },
            {
                onSuccess: (result) => {
                    toast.success(
                        intl.formatMessage(messages.created, {
                            name: result.rule.name,
                            opened: result.scan.open
                        })
                    );
                    onOpenChange(false);
                    setName('');
                    setFindingTitle('');
                },
                onError: (error) =>
                    toast.error(
                        intl.formatMessage(messages.failed, {
                            reason: (error as Error).message
                        })
                    )
            }
        );
    };

    const canSubmit =
        Boolean(filter) &&
        name.trim().length > 0 &&
        findingTitle.trim().length > 0 &&
        !create.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description, {
                            contentType
                        })}
                    </DialogDescription>
                </DialogHeader>

                {filter === null ? (
                    <p className="text-sm text-destructive">
                        {intl.formatMessage(messages.badFilter)}
                    </p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <InputField
                            id="alarms-rule-name"
                            label={intl.formatMessage(messages.name)}
                            description={intl.formatMessage(messages.nameHint)}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <InputField
                            id="alarms-rule-finding-title"
                            label={intl.formatMessage(messages.findingTitle)}
                            description={intl.formatMessage(
                                messages.findingHint
                            )}
                            value={findingTitle}
                            onChange={(event) =>
                                setFindingTitle(event.target.value)
                            }
                        />

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="alarms-severity">
                                {intl.formatMessage(messages.severity)}
                            </Label>
                            <Select
                                value={severity}
                                onValueChange={(next) =>
                                    setSeverity(next as AlarmSeverity)
                                }
                            >
                                <SelectTrigger id="alarms-severity">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ALARM_SEVERITIES.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {intl.formatMessage(
                                                SEVERITY_LABELS[value]
                                            )}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <p
                            className="text-sm text-muted-foreground"
                            aria-live="polite"
                        >
                            {preview.isPending
                                ? intl.formatMessage(messages.checking)
                                : preview.data
                                  ? intl.formatMessage(messages.matches, {
                                        matched: preview.data.matched,
                                        total: preview.data.total
                                    })
                                  : null}
                        </p>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    <Button disabled={!canSubmit} onClick={submit}>
                        {create.isPending ? <Spinner /> : null}
                        {intl.formatMessage(messages.submit)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
