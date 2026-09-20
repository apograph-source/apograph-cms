import { useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { BookOpen, Lock } from 'lucide-react';
import {
    Badge,
    Button,
    Checkbox,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn
} from '@orthacms/design-system';
import type { CopilotSkill } from '../../application/useSkills';

const messages = defineMessages({
    open: {
        id: 'copilot.skills.open',
        defaultMessage: 'Skills'
    },
    openWithCount: {
        id: 'copilot.skills.openWithCount',
        defaultMessage: '{count, plural, one {# skill} other {# skills}}'
    },
    heading: {
        id: 'copilot.skills.heading',
        defaultMessage: 'Skills for this chat'
    },
    explain: {
        id: 'copilot.skills.explain',
        defaultMessage:
            'Working instructions Ortha AI follows while they are on.'
    },
    filter: {
        id: 'copilot.skills.filter',
        defaultMessage: 'Filter skills'
    },
    empty: {
        id: 'copilot.skills.empty',
        defaultMessage: 'This workspace has no skills yet.'
    },
    noMatches: {
        id: 'copilot.skills.noMatches',
        defaultMessage: 'No skill matches that.'
    },
    alwaysSection: {
        id: 'copilot.skills.alwaysSection',
        defaultMessage: 'Always on'
    },
    alwaysExplain: {
        id: 'copilot.skills.alwaysExplain',
        defaultMessage:
            'On for every chat in this workspace. An administrator sets these.'
    },
    fromCode: {
        id: 'copilot.skills.fromCode',
        defaultMessage: 'From code'
    },
    limit: {
        id: 'copilot.skills.limit',
        defaultMessage:
            'Up to {max, plural, one {# skill} other {# skills}} at a time.'
    }
});

export interface SkillPickerProps {
    /** Everything the workspace offers, always-on ones included. */
    skills: readonly CopilotSkill[];
    /** The names staged for the next turn. */
    selected: readonly string[];
    /** Replaces the staged set. */
    onChange(names: readonly string[]): void;
    /** How many may be staged at once — mirrors the server's `MAX_RUN_SKILLS`. */
    max: number;
    /** True while the catalogue is still loading. */
    loading?: boolean;
}

/**
 * The composer's skills control: a button that opens a filterable list of the
 * workspace's skills, each with a checkbox.
 *
 * **Always-on skills are listed but not toggleable.** They are in force on
 * every run whatever this picker says, so a checkbox for one would be a control
 * that appears to do something and does not — and leaving them out entirely
 * would be worse, because then nothing on screen tells a person why the answers
 * read the way they do.
 *
 * The button carries the count rather than only a dot: the whole point of the
 * control is that a run behaves differently, and a colour-only signal for that
 * is no signal at all.
 */
export function SkillPicker({
    skills,
    selected,
    onChange,
    max,
    loading = false
}: SkillPickerProps) {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const headingId = useId();

    const always = skills.filter((skill) => skill.mode === 'always');
    const attachable = skills.filter((skill) => skill.mode === 'manual');

    const needle = filter.trim().toLowerCase();
    const matches = (skill: CopilotSkill) =>
        needle === '' ||
        skill.title.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle);

    const shown = attachable.filter(matches);
    const shownAlways = always.filter(matches);

    // A filter over three rows is furniture that pushes the rows it searches
    // down the list — the same threshold the thread rail uses.
    const showFilter = skills.length > 5;

    const toggle = (name: string) => {
        if (selected.includes(name)) {
            onChange(selected.filter((entry) => entry !== name));
            return;
        }
        // Silently dropping the click would read as a broken checkbox, so the
        // rows are disabled at the ceiling instead and this can only be reached
        // by a race.
        if (selected.length >= max) {
            return;
        }
        onChange([...selected, name]);
    };

    // Nothing to offer and nothing in force: no control at all, rather than a
    // button that opens an empty popover. A workspace that has never authored
    // a skill should not carry the furniture for the feature.
    if (!loading && skills.length === 0) {
        return null;
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-7 shrink-0 gap-1.5 px-2 text-xs',
                        selected.length > 0
                            ? 'bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft'
                            : 'text-muted-foreground'
                    )}
                    // **No `aria-label`.** The visible text already names the
                    // control, and a label saying "Skills" would override the
                    // count with the one thing it must not hide: a colour-only
                    // signal that this run behaves differently is no signal.
                >
                    <BookOpen className="size-3.5" />
                    {selected.length > 0
                        ? intl.formatMessage(messages.openWithCount, {
                              count: selected.length
                          })
                        : intl.formatMessage(messages.open)}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80 p-0"
                aria-labelledby={headingId}
            >
                <div className="border-border/60 border-b px-3 py-2.5">
                    <p id={headingId} className="text-sm font-medium">
                        {intl.formatMessage(messages.heading)}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                        {intl.formatMessage(messages.explain)}
                    </p>
                </div>

                {showFilter ? (
                    <div className="px-3 pt-2.5">
                        <Input
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder={intl.formatMessage(messages.filter)}
                            aria-label={intl.formatMessage(messages.filter)}
                            className="h-8 text-sm"
                        />
                    </div>
                ) : null}

                <div className="max-h-72 overflow-y-auto p-1.5">
                    {shown.length === 0 && shownAlways.length === 0 ? (
                        <p className="text-muted-foreground px-2 py-3 text-xs">
                            {intl.formatMessage(
                                skills.length === 0
                                    ? messages.empty
                                    : messages.noMatches
                            )}
                        </p>
                    ) : null}

                    {shown.map((skill) => {
                        const checked = selected.includes(skill.name);
                        return (
                            <SkillRow
                                key={skill.name}
                                skill={skill}
                                checked={checked}
                                // At the ceiling the unchecked rows go quiet
                                // rather than the click being swallowed.
                                disabled={!checked && selected.length >= max}
                                onToggle={() => toggle(skill.name)}
                                codeLabel={intl.formatMessage(
                                    messages.fromCode
                                )}
                            />
                        );
                    })}

                    {shownAlways.length > 0 ? (
                        <div className="mt-1.5">
                            <p className="text-muted-foreground px-2 pt-1.5 text-[11px] font-medium tracking-wide uppercase">
                                {intl.formatMessage(messages.alwaysSection)}
                            </p>
                            <p className="text-muted-foreground px-2 pb-1 text-xs">
                                {intl.formatMessage(messages.alwaysExplain)}
                            </p>
                            {shownAlways.map((skill) => (
                                <div
                                    key={skill.name}
                                    className="flex items-start gap-2 rounded-md px-2 py-1.5"
                                >
                                    <Lock className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm">
                                            {skill.title}
                                        </p>
                                        <p className="text-muted-foreground line-clamp-2 text-xs">
                                            {skill.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <p className="text-muted-foreground border-border/60 border-t px-3 py-2 text-[11px]">
                    {intl.formatMessage(messages.limit, { max })}
                </p>
            </PopoverContent>
        </Popover>
    );
}

/** One attachable skill: a checkbox, its title, and what it is for. */
function SkillRow({
    skill,
    checked,
    disabled,
    onToggle,
    codeLabel
}: {
    skill: CopilotSkill;
    checked: boolean;
    disabled: boolean;
    onToggle(): void;
    codeLabel: string;
}) {
    const id = useId();
    return (
        <div
            className={cn(
                'hover:bg-accent flex items-start gap-2 rounded-md px-2 py-1.5',
                disabled && 'opacity-50'
            )}
        >
            <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={onToggle}
                className="mt-0.5"
            />
            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{skill.title}</span>
                    {skill.source === 'code' ? (
                        <Badge
                            variant="outline"
                            className="shrink-0 px-1 py-0 text-[10px] font-normal"
                        >
                            {codeLabel}
                        </Badge>
                    ) : null}
                </span>
                <span className="text-muted-foreground line-clamp-2 block text-xs">
                    {skill.description}
                </span>
            </label>
        </div>
    );
}
