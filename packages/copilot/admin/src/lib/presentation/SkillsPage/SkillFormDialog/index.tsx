import { useEffect, useState, type FormEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Checkbox,
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
    Textarea
} from '@orthacms/design-system';
import {
    MAX_SKILL_DESCRIPTION_LENGTH,
    MAX_SKILL_INSTRUCTIONS_LENGTH,
    SKILL_NAME_PATTERN
} from '@orthacms/copilot-domain';
import type { CopilotSkillDetail } from '../../../application/useManageSkills';

const messages = defineMessages({
    createTitle: {
        id: 'copilot.skills.form.createTitle',
        defaultMessage: 'New skill'
    },
    editTitle: {
        id: 'copilot.skills.form.editTitle',
        defaultMessage: 'Edit skill'
    },
    explain: {
        id: 'copilot.skills.form.explain',
        defaultMessage:
            'Instructions Ortha AI follows while this skill is on. Everyone in this workspace can use it.'
    },
    title: { id: 'copilot.skills.form.title', defaultMessage: 'Name' },
    titleHint: {
        id: 'copilot.skills.form.titleHint',
        defaultMessage: 'What people see in the picker.'
    },
    slug: { id: 'copilot.skills.form.slug', defaultMessage: 'Identifier' },
    slugHint: {
        id: 'copilot.skills.form.slugHint',
        defaultMessage: 'Lowercase letters, digits and hyphens.'
    },
    description: {
        id: 'copilot.skills.form.description',
        defaultMessage: 'When to use it'
    },
    descriptionHint: {
        id: 'copilot.skills.form.descriptionHint',
        defaultMessage:
            'One or two sentences. Ortha AI reads this to decide whether to suggest the skill.'
    },
    instructions: {
        id: 'copilot.skills.form.instructions',
        defaultMessage: 'Instructions'
    },
    instructionsHint: {
        id: 'copilot.skills.form.instructionsHint',
        defaultMessage: '{used} of {max} characters used.'
    },
    mode: { id: 'copilot.skills.form.mode', defaultMessage: 'When it applies' },
    modeManual: {
        id: 'copilot.skills.form.modeManual',
        defaultMessage: 'When someone turns it on'
    },
    modeAlways: {
        id: 'copilot.skills.form.modeAlways',
        defaultMessage: 'Every chat in this workspace'
    },
    enabled: {
        id: 'copilot.skills.form.enabled',
        defaultMessage: 'Available to use'
    },
    save: { id: 'copilot.skills.form.save', defaultMessage: 'Save' },
    saving: { id: 'copilot.skills.form.saving', defaultMessage: 'Saving…' },
    cancel: { id: 'copilot.skills.form.cancel', defaultMessage: 'Cancel' },
    nameInvalid: {
        id: 'copilot.skills.form.nameInvalid',
        defaultMessage:
            'Use lowercase letters, digits and hyphens — for example house-style.'
    },
    required: {
        id: 'copilot.skills.form.required',
        defaultMessage: 'This is required.'
    }
});

/** What the dialog hands back on save. */
export interface SkillFormValues {
    name: string;
    title: string;
    description: string;
    instructions: string;
    mode: 'manual' | 'always';
    enabled: boolean;
}

export interface SkillFormDialogProps {
    open: boolean;
    /** The skill being edited, or `null` to create one. */
    skill: CopilotSkillDetail | null;
    /** True while the record behind an edit is still loading. */
    loading?: boolean;
    /** True while a save is in flight. */
    saving?: boolean;
    /** The server's reason for refusing the last save, when it refused one. */
    error?: string | null;
    onSubmit(values: SkillFormValues): void;
    onOpenChange(open: boolean): void;
}

/** A blank skill. */
const EMPTY: SkillFormValues = {
    name: '',
    title: '',
    description: '',
    instructions: '',
    mode: 'manual',
    enabled: true
};

/**
 * Create and edit, in one dialog.
 *
 * **Save is disabled only while saving, never on a validation error.** A greyed
 * out Save refuses without saying why, and on a field nobody has blurred there
 * is no message on screen either — submitting is what surfaces the reason. Same
 * rule the rename dialog in the thread rail follows.
 *
 * The identifier follows the name **while creating** and stops the moment
 * anyone edits either one by hand. Editing an existing skill never re-links
 * them: a run names a skill by its identifier, so having it change under a
 * title edit would silently un-attach the skill from every composer holding it
 * staged. It stays editable, because renaming is legitimate — it just has to be
 * something you did on purpose.
 */
export function SkillFormDialog({
    open,
    skill,
    loading = false,
    saving = false,
    error,
    onSubmit,
    onOpenChange
}: SkillFormDialogProps) {
    const intl = useIntl();
    const [values, setValues] = useState<SkillFormValues>(EMPTY);
    const [touched, setTouched] = useState(false);
    // Whether the identifier is still following the name. It stops the moment
    // someone edits it by hand, and never starts on an existing skill.
    const [linked, setLinked] = useState(true);

    // Reset when the dialog opens onto a different skill. Keyed on the id
    // rather than on `open` alone so reopening the same row does not discard an
    // edit the user is mid-way through after a failed save.
    useEffect(() => {
        if (!open) {
            return;
        }
        setTouched(false);
        setLinked(!skill);
        setValues(
            skill
                ? {
                      name: skill.name,
                      title: skill.title,
                      description: skill.description,
                      instructions: skill.instructions,
                      mode: skill.mode,
                      enabled: skill.enabled
                  }
                : EMPTY
        );
    }, [open, skill]);

    const set = <K extends keyof SkillFormValues>(
        key: K,
        value: SkillFormValues[K]
    ) => setValues((current) => ({ ...current, [key]: value }));

    const nameProblem =
        values.name.length > 0 && !SKILL_NAME_PATTERN.test(values.name)
            ? intl.formatMessage(messages.nameInvalid)
            : undefined;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (
            !values.title.trim() ||
            !values.description.trim() ||
            !values.instructions.trim() ||
            !SKILL_NAME_PATTERN.test(values.name)
        ) {
            return;
        }
        onSubmit(values);
    };

    const missing = (value: string) =>
        touched && !value.trim()
            ? intl.formatMessage(messages.required)
            : undefined;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(
                            skill ? messages.editTitle : messages.createTitle
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.explain)}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={submit} className="flex flex-col gap-4">
                    <InputField
                        id="skill-title"
                        label={intl.formatMessage(messages.title)}
                        description={intl.formatMessage(messages.titleHint)}
                        value={values.title}
                        disabled={loading}
                        error={missing(values.title)}
                        onChange={(event) => {
                            const title = event.target.value;
                            set('title', title);
                            if (linked) {
                                set('name', slugify(title));
                            }
                        }}
                    />

                    <InputField
                        id="skill-name"
                        label={intl.formatMessage(messages.slug)}
                        description={intl.formatMessage(messages.slugHint)}
                        value={values.name}
                        disabled={loading}
                        error={nameProblem ?? missing(values.name)}
                        onChange={(event) => {
                            setLinked(false);
                            set('name', event.target.value);
                        }}
                    />

                    <InputField
                        id="skill-description"
                        label={intl.formatMessage(messages.description)}
                        description={intl.formatMessage(
                            messages.descriptionHint
                        )}
                        value={values.description}
                        disabled={loading}
                        error={missing(values.description)}
                        maxLength={MAX_SKILL_DESCRIPTION_LENGTH}
                        onChange={(event) =>
                            set('description', event.target.value)
                        }
                    />

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="skill-instructions">
                            {intl.formatMessage(messages.instructions)}
                        </Label>
                        <Textarea
                            id="skill-instructions"
                            value={values.instructions}
                            disabled={loading}
                            rows={12}
                            className="font-mono text-xs"
                            onChange={(event) =>
                                set('instructions', event.target.value)
                            }
                        />
                        <p className="text-muted-foreground text-xs">
                            {intl.formatMessage(messages.instructionsHint, {
                                used: values.instructions.length,
                                max: MAX_SKILL_INSTRUCTIONS_LENGTH
                            })}
                        </p>
                        {missing(values.instructions) ? (
                            <p className="text-destructive text-xs">
                                {missing(values.instructions)}
                            </p>
                        ) : null}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="skill-mode">
                            {intl.formatMessage(messages.mode)}
                        </Label>
                        <Select
                            value={values.mode}
                            onValueChange={(mode) =>
                                set('mode', mode as 'manual' | 'always')
                            }
                        >
                            <SelectTrigger id="skill-mode">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">
                                    {intl.formatMessage(messages.modeManual)}
                                </SelectItem>
                                <SelectItem value="always">
                                    {intl.formatMessage(messages.modeAlways)}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="skill-enabled"
                            checked={values.enabled}
                            onCheckedChange={(checked) =>
                                set('enabled', checked === true)
                            }
                        />
                        <Label htmlFor="skill-enabled" className="font-normal">
                            {intl.formatMessage(messages.enabled)}
                        </Label>
                    </div>

                    {error ? (
                        <p role="alert" className="text-destructive text-sm">
                            {error}
                        </p>
                    ) : null}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button type="submit" disabled={saving || loading}>
                            {intl.formatMessage(
                                saving ? messages.saving : messages.save
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/**
 * A title turned into a candidate identifier.
 *
 * Only a starting point — the field stays editable, and it stops following the
 * title the moment anyone touches it. Non-ASCII is dropped rather than
 * transliterated: a guessed romanisation of someone's language is worse than an
 * empty field they fill in themselves.
 */
function slugify(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}
