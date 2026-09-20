import { useId, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Upload } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    RadioGroup,
    RadioGroupItem,
    Spinner,
    toast
} from '@orthacms/design-system';
import {
    CONFLICT_POLICY,
    RELATION_POLICY,
    type ConflictPolicy,
    type ImportPreview,
    type RelationPolicy
} from '@orthacms/transfer-domain';
import { useImportPreview } from '../../api/useImportPreview';
import { useImportApply } from '../../api/useImportApply';
import { ImportVerdictList } from '../ImportVerdictList';

const messages = defineMessages({
    title: { id: 'transfer.import.title', defaultMessage: 'Import records' },
    description: {
        id: 'transfer.import.description',
        defaultMessage:
            'Choose a file exported from Ortha, or a CSV matching this collection’s columns. Nothing is written until you’ve seen what will change.'
    },
    file: { id: 'transfer.import.file', defaultMessage: 'File' },
    fileHint: {
        id: 'transfer.import.file.hint',
        defaultMessage: 'JSON, JSON Lines, CSV or a ZIP archive.'
    },
    template: {
        id: 'transfer.import.template',
        defaultMessage: 'Download a blank CSV with the right columns'
    },
    policy: {
        id: 'transfer.import.policy',
        defaultMessage: 'If a record is already here'
    },
    policyHint: {
        id: 'transfer.import.policy.hint',
        defaultMessage:
            'A record counts as already here when it matches one of yours — by a key field like a slug or an email, or by being the very record this file was exported from.'
    },
    policySkip: {
        id: 'transfer.import.policy.skip',
        defaultMessage: 'Leave it alone'
    },
    policySkipHint: {
        id: 'transfer.import.policy.skip.hint',
        defaultMessage:
            'Nothing is written to it. Everything the file adds that isn’t here yet still imports. Safest, and the usual choice for re-running a file.'
    },
    policyUpdate: {
        id: 'transfer.import.policy.update',
        defaultMessage: 'Update it with the file’s values'
    },
    policyUpdateHint: {
        id: 'transfer.import.policy.update.hint',
        defaultMessage:
            'The file wins: its values replace what’s here. Edits made since the export are lost. Use this when the file is the newer copy.'
    },
    policyDuplicate: {
        id: 'transfer.import.policy.duplicate',
        defaultMessage: 'Add a second copy'
    },
    policyDuplicateHint: {
        id: 'transfer.import.policy.duplicate.hint',
        defaultMessage:
            'Keeps yours and adds the file’s alongside it, so you end up with two. Handy for cloning content to edit; easy to do by accident twice.'
    },
    policyFail: {
        id: 'transfer.import.policy.fail',
        defaultMessage: 'Stop and import nothing'
    },
    policyFailHint: {
        id: 'transfer.import.policy.fail.hint',
        defaultMessage:
            'The first match cancels the whole run and nothing is written. For when an overlap means the file is the wrong one.'
    },
    relations: {
        id: 'transfer.import.relations',
        defaultMessage: 'Records this file links to'
    },
    relationsHint: {
        id: 'transfer.import.relations.hint',
        defaultMessage:
            'An export carries the records yours point at — authors, categories, tags — so the links can be made again here.'
    },
    relationsLink: {
        id: 'transfer.import.relations.link',
        defaultMessage: 'Link to the ones already here'
    },
    relationsLinkHint: {
        id: 'transfer.import.relations.link.hint',
        defaultMessage:
            'Your imported records point at the author or tag you already have, and nothing is written to it. Only a linked record that’s missing gets created.'
    },
    relationsUpdate: {
        id: 'transfer.import.relations.update',
        defaultMessage: 'Link to them, and update them from the file'
    },
    relationsUpdateHint: {
        id: 'transfer.import.relations.update.hint',
        defaultMessage:
            'The same, except the file’s copy also overwrites the one here — so the author’s details come from the file too.'
    },
    relationsRecreate: {
        id: 'transfer.import.relations.recreate',
        defaultMessage: 'Add them again as new records'
    },
    relationsRecreateHint: {
        id: 'transfer.import.relations.recreate.hint',
        defaultMessage:
            'A fresh copy of every linked record, even when one of the same name is here, and the imported records point at the copies. For content that only looks the same.'
    },
    check: { id: 'transfer.import.check', defaultMessage: 'Check the file' },
    checking: {
        id: 'transfer.import.checking',
        defaultMessage: 'Checking…'
    },
    summary: {
        id: 'transfer.import.summary',
        defaultMessage:
            '{create, plural, one {# to add} other {# to add}} · {update, plural, one {# to update} other {# to update}} · {skip, plural, one {# skipped} other {# skipped}} · {error, plural, one {# problem} other {# problems}}'
    },
    assetSummary: {
        id: 'transfer.import.assetSummary',
        defaultMessage:
            '{assetsNew, plural, one {# new file} other {# new files}}, {assetsReused, plural, one {# already here} other {# already here}}.'
    },
    nothing: {
        id: 'transfer.import.nothing',
        defaultMessage:
            'Nothing in this file would change anything here. It may already have been imported.'
    },
    cancel: { id: 'transfer.import.cancel', defaultMessage: 'Cancel' },
    back: { id: 'transfer.import.back', defaultMessage: 'Choose another file' },
    confirm: { id: 'transfer.import.confirm', defaultMessage: 'Import' },
    done: {
        id: 'transfer.import.done.toast',
        defaultMessage:
            'Imported {create, plural, one {# new record} other {# new records}} and updated {update, plural, one {# record} other {# records}}.'
    },
    failed: {
        id: 'transfer.import.failed.toast',
        defaultMessage: 'That import didn’t work.'
    }
});

const POLICY_LABEL = {
    [CONFLICT_POLICY.Skip]: messages.policySkip,
    [CONFLICT_POLICY.Update]: messages.policyUpdate,
    [CONFLICT_POLICY.Duplicate]: messages.policyDuplicate,
    [CONFLICT_POLICY.Fail]: messages.policyFail
} as const;

const POLICY_HINT = {
    [CONFLICT_POLICY.Skip]: messages.policySkipHint,
    [CONFLICT_POLICY.Update]: messages.policyUpdateHint,
    [CONFLICT_POLICY.Duplicate]: messages.policyDuplicateHint,
    [CONFLICT_POLICY.Fail]: messages.policyFailHint
} as const;

const POLICY_ORDER: ConflictPolicy[] = [
    CONFLICT_POLICY.Skip,
    CONFLICT_POLICY.Update,
    CONFLICT_POLICY.Duplicate,
    CONFLICT_POLICY.Fail
];

const RELATION_LABEL = {
    [RELATION_POLICY.Link]: messages.relationsLink,
    [RELATION_POLICY.Update]: messages.relationsUpdate,
    [RELATION_POLICY.Recreate]: messages.relationsRecreate
} as const;

const RELATION_HINT = {
    [RELATION_POLICY.Link]: messages.relationsLinkHint,
    [RELATION_POLICY.Update]: messages.relationsUpdateHint,
    [RELATION_POLICY.Recreate]: messages.relationsRecreateHint
} as const;

const RELATION_ORDER: RelationPolicy[] = [
    RELATION_POLICY.Link,
    RELATION_POLICY.Update,
    RELATION_POLICY.Recreate
];

/**
 * One labelled radio group of policy values.
 *
 * The dialog asks two questions of the same shape — what to do with the records
 * in the file, and what to do with the records they point at — and they must
 * read as the same kind of choice, because the whole point of splitting them is
 * that a reader can see they are separate answers.
 */
function PolicyChoice<T extends string>({
    idPrefix,
    legend,
    hint,
    value,
    options,
    labelOf,
    describeOf,
    onChange
}: {
    idPrefix: string;
    legend: string;
    /** A sentence under the legend, when the question needs context. */
    hint?: string;
    value: T;
    options: readonly T[];
    labelOf: (value: T) => string;
    /** What this option actually does, under its label. */
    describeOf: (value: T) => string;
    onChange: (value: T) => void;
}) {
    const hintId = `${idPrefix}-hint`;
    return (
        // Three spacings, deliberately different, so the group reads as a
        // hierarchy rather than a list of five equal lines: the hint sits close
        // under its legend (they are one heading), the options are pushed away
        // from that heading, and the options are spaced from each other.
        <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">{legend}</legend>
            {hint ? (
                <p id={hintId} className="text-muted-foreground text-xs">
                    {hint}
                </p>
            ) : null}
            <RadioGroup
                className="mt-2.5 gap-3.5"
                value={value}
                aria-describedby={hint ? hintId : undefined}
                onValueChange={(next) => onChange(next as T)}
            >
                {options.map((option) => {
                    const optionId = `${idPrefix}-${option}`;
                    return (
                        // The same shape as the export dialog's toggles —
                        // control, then label over description — so the two
                        // dialogs read as one feature.
                        <div key={option} className="flex items-start gap-3">
                            <RadioGroupItem
                                id={optionId}
                                value={option}
                                aria-describedby={`${optionId}-hint`}
                                className="mt-0.5"
                            />
                            <div className="grid gap-0.5">
                                <Label
                                    htmlFor={optionId}
                                    className="cursor-pointer font-normal"
                                >
                                    {labelOf(option)}
                                </Label>
                                <span
                                    id={`${optionId}-hint`}
                                    className="text-muted-foreground text-xs"
                                >
                                    {describeOf(option)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </RadioGroup>
        </fieldset>
    );
}

/** The message from a failed request, if the server sent one worth showing. */
function serverMessage(error: unknown): string | undefined {
    const message = (
        error as { response?: { data?: { message?: unknown } } } | undefined
    )?.response?.data?.message;
    return typeof message === 'string' ? message : undefined;
}

/**
 * The import dialog: pick a file, see what it would do, then do it.
 *
 * The two phases are not a nicety. An import is the one content operation that
 * can rewrite many records at once from a file the person did not necessarily
 * author, and "run it and find out" is not an acceptable interaction for that.
 * The check step calls the same pipeline the apply step does, so what the table
 * shows is what will happen.
 */
export function ImportDialog({
    open,
    onOpenChange,
    typeName,
    workspaceId
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    typeName: string;
    /** The open workspace — what the refreshed caches are scoped to. */
    workspaceId: string;
}) {
    const intl = useIntl();
    const fieldId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [policy, setPolicy] = useState<ConflictPolicy>(CONFLICT_POLICY.Skip);
    const [relations, setRelations] = useState<RelationPolicy>(
        RELATION_POLICY.Link
    );
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [error, setError] = useState<string | null>(null);

    const previewMutation = useImportPreview();
    const applyMutation = useImportApply();

    const reset = (): void => {
        setFile(null);
        setPreview(null);
        setError(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const close = (): void => {
        reset();
        onOpenChange(false);
    };

    const check = (): void => {
        if (!file) return;
        setError(null);
        previewMutation
            .mutateAsync({ typeName, file, policy, relations })
            .then(setPreview)
            .catch((cause) =>
                setError(
                    serverMessage(cause) ?? intl.formatMessage(messages.failed)
                )
            );
    };

    const apply = (): void => {
        if (!file) return;
        setError(null);
        applyMutation
            .mutateAsync({ typeName, workspaceId, file, policy, relations })
            .then((result) => {
                toast.success(
                    intl.formatMessage(messages.done, {
                        create: result.counts.create,
                        update: result.counts.update
                    })
                );
                close();
            })
            .catch((cause) =>
                setError(
                    serverMessage(cause) ?? intl.formatMessage(messages.failed)
                )
            );
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        >
            {/* Capped and scrolled, because `DialogContent` sets no height of
                its own: it is centred and fixed, so a tall one runs off both
                ends of the viewport with its header and its Import button
                unreachable. Three rows — header, body, footer — and only the
                middle one scrolls, so the primary action stays on screen
                however long the verdict table gets. */}
            <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                {/* A wide gap between blocks, because the dialog asks two
                    separate questions and a reader has to see they are
                    separate. At the group's own 12px option rhythm they read as
                    one seven-item list with two headings in it. */}
                <div className="-mx-1 grid gap-8 overflow-y-auto px-1 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor={`${fieldId}-file`}>
                            {intl.formatMessage(messages.file)}
                        </Label>
                        <input
                            ref={inputRef}
                            id={`${fieldId}-file`}
                            type="file"
                            accept=".json,.ndjson,.jsonl,.csv,.zip"
                            aria-describedby={`${fieldId}-file-hint`}
                            className="border-input file:text-foreground w-full rounded-md border bg-transparent px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
                            onChange={(event) => {
                                // A new file invalidates the previous verdict —
                                // showing one file's table above another file's
                                // Import button is the worst possible bug here.
                                setPreview(null);
                                setError(null);
                                setFile(event.target.files?.[0] ?? null);
                            }}
                        />
                        <span
                            id={`${fieldId}-file-hint`}
                            className="text-muted-foreground text-xs"
                        >
                            {intl.formatMessage(messages.fileHint)}{' '}
                            <a
                                className="underline underline-offset-2"
                                href={`/api/content/${typeName}/import/template`}
                            >
                                {intl.formatMessage(messages.template)}
                            </a>
                        </span>
                    </div>

                    {/* The verdicts depend on both settings, so changing
                        either retires the table rather than leaving a stale one
                        that no longer describes the run. */}
                    <PolicyChoice
                        idPrefix={`${fieldId}-policy`}
                        legend={intl.formatMessage(messages.policy)}
                        hint={intl.formatMessage(messages.policyHint)}
                        value={policy}
                        options={POLICY_ORDER}
                        labelOf={(value) =>
                            intl.formatMessage(POLICY_LABEL[value])
                        }
                        describeOf={(value) =>
                            intl.formatMessage(POLICY_HINT[value])
                        }
                        onChange={(next) => {
                            setPreview(null);
                            setPolicy(next);
                        }}
                    />

                    <PolicyChoice
                        idPrefix={`${fieldId}-relations`}
                        legend={intl.formatMessage(messages.relations)}
                        hint={intl.formatMessage(messages.relationsHint)}
                        value={relations}
                        options={RELATION_ORDER}
                        labelOf={(value) =>
                            intl.formatMessage(RELATION_LABEL[value])
                        }
                        describeOf={(value) =>
                            intl.formatMessage(RELATION_HINT[value])
                        }
                        onChange={(next) => {
                            setPreview(null);
                            setRelations(next);
                        }}
                    />

                    {error ? (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    {preview ? (
                        <div className="grid gap-2">
                            <p className="text-sm" aria-live="polite">
                                {intl.formatMessage(messages.summary, {
                                    ...preview.counts
                                })}
                            </p>
                            {preview.counts.assetsNew +
                                preview.counts.assetsReused >
                            0 ? (
                                <p className="text-muted-foreground text-xs">
                                    {intl.formatMessage(messages.assetSummary, {
                                        ...preview.counts
                                    })}
                                </p>
                            ) : null}
                            {!preview.hasChanges ? (
                                <Alert>
                                    <AlertDescription>
                                        {intl.formatMessage(messages.nothing)}
                                    </AlertDescription>
                                </Alert>
                            ) : null}
                            <ImportVerdictList verdicts={preview.verdicts} />
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={close}>
                        {intl.formatMessage(messages.cancel)}
                    </Button>
                    {preview ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={reset}
                            >
                                {intl.formatMessage(messages.back)}
                            </Button>
                            <Button
                                type="button"
                                disabled={
                                    applyMutation.isPending ||
                                    !preview.hasChanges
                                }
                                onClick={apply}
                            >
                                {applyMutation.isPending ? (
                                    <Spinner aria-hidden />
                                ) : (
                                    <Upload aria-hidden />
                                )}
                                {intl.formatMessage(messages.confirm)}
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            disabled={!file || previewMutation.isPending}
                            onClick={check}
                        >
                            {previewMutation.isPending ? (
                                <>
                                    <Spinner aria-hidden />
                                    {intl.formatMessage(messages.checking)}
                                </>
                            ) : (
                                intl.formatMessage(messages.check)
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
