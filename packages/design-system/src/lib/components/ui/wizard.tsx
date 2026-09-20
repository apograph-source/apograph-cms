import type { ReactNode } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '../../utils';
import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';

/**
 * Generic, configurable chrome for a multi-step wizard: a progress `Stepper`
 * rail, an animated `WizardStepCard`, and a contextual `WizardFooter`. It owns
 * no copy or i18n — labels are passed in — and no step state, so any feature can
 * drive it with its own steps and navigation.
 */

/** One step in the {@link Stepper} rail. */
export type StepperStep = {
    /** Short label, e.g. "Basics". */
    label: string;
    /** One-line hint shown under the label. */
    hint: string;
    /** Whether the step may be skipped (badged with {@link StepperProps.optionalLabel}). */
    optional?: boolean;
    /** Summary chip shown once the step is complete (e.g. the entered name). */
    summary?: string;
};

/** Props for {@link Stepper}. */
export type StepperProps = {
    /** Active step (1-based). */
    current: number;
    /** Highest step reached — steps up to here are navigable. */
    maxReached: number;
    /** Ordered step definitions. */
    steps: StepperStep[];
    /** Jump to a (reached) step. */
    onStepClick: (step: number) => void;
    /** Localized text for the "Optional" badge (omit to hide it). */
    optionalLabel?: string;
    /** Localized accessible label for a marker, e.g. `Step 2: Members`. */
    stepAriaLabel: (step: StepperStep, number: number) => string;
};

/**
 * The vertical progress rail: a numbered marker per step (a check once
 * complete), a connector that fills as steps complete, the label, hint, an
 * optional badge for skippable steps, and a summary chip of what was entered.
 * Completed steps are clickable to jump back; upcoming steps are disabled.
 */
export function Stepper({
    current,
    maxReached,
    steps,
    onStepClick,
    optionalLabel,
    stepAriaLabel
}: StepperProps) {
    return (
        <ol className="flex flex-col">
            {steps.map((step, index) => {
                const n = index + 1;
                const reached = n <= maxReached;
                const active = n === current;
                const complete = reached && !active;
                const isLast = index === steps.length - 1;

                return (
                    <li
                        // Position, not `label`: the label is consumer copy,
                        // and two steps may legitimately share one. The rail is
                        // a fixed ordered list, so the index *is* the identity.
                        key={index}
                        className="relative flex gap-3 pb-6 last:pb-0"
                    >
                        {!isLast ? (
                            <span
                                aria-hidden
                                className="absolute bottom-1 left-[14px] top-[30px] w-0.5 bg-border"
                            >
                                <span
                                    className={cn(
                                        'block w-full bg-primary transition-[height] duration-300',
                                        complete ? 'h-full' : 'h-0'
                                    )}
                                />
                            </span>
                        ) : null}

                        <button
                            type="button"
                            disabled={!reached}
                            aria-current={active ? 'step' : undefined}
                            aria-label={stepAriaLabel(step, n)}
                            onClick={() => onStepClick(n)}
                            className={cn(
                                'relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors',
                                complete &&
                                    'border-primary bg-primary text-primary-foreground',
                                active && 'border-primary text-foreground',
                                !reached &&
                                    'border-border text-muted-foreground',
                                reached && !complete && 'cursor-pointer',
                                active &&
                                    'ring-4 ring-[color-mix(in_oklch,var(--color-primary)_8%,transparent)]'
                            )}
                        >
                            {complete ? <Check className="size-4" /> : n}
                        </button>

                        <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                            <div className="flex items-center gap-2">
                                <span
                                    className={cn(
                                        'text-sm font-medium',
                                        !reached && 'text-muted-foreground'
                                    )}
                                >
                                    {step.label}
                                </span>
                                {step.optional && optionalLabel ? (
                                    <Badge
                                        variant="secondary"
                                        className="px-1.5 py-0 text-[10px] font-normal"
                                    >
                                        {optionalLabel}
                                    </Badge>
                                ) : null}
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {step.hint}
                            </span>
                            {complete && step.summary ? (
                                <span className="mt-0.5 w-fit max-w-full truncate rounded-xl bg-muted px-2 py-0.5 text-xs text-foreground">
                                    {step.summary}
                                </span>
                            ) : null}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

/** Props for {@link WizardStepCard}. */
export type WizardStepCardProps = {
    /** Step body. */
    children: ReactNode;
    /** Extra classes. */
    className?: string;
};

/**
 * Card wrapper for a wizard step. Give it `key={step}` so it remounts on each
 * step change and replays the `wizard-step-in` entrance.
 *
 * The animation transforms only — opacity stays 1 — so content is never hidden
 * if the motion clock is paused (background tab, print), and
 * `prefers-reduced-motion: reduce` disables it. The rules ship in the
 * design-system stylesheet (`@orthacms/design-system/src/styles.css`).
 */
export function WizardStepCard({ children, className }: WizardStepCardProps) {
    return <Card className={cn('wizard-step-in', className)}>{children}</Card>;
}

/** Props for {@link WizardFooter}. */
export type WizardFooterProps = {
    /** Quiet helper text shown on the left when there's no Back button. */
    hint?: ReactNode;
    /** Back handler — renders a Back button on the left when provided. */
    onBack?: () => void;
    /** Back button label. */
    backLabel?: string;
    /** Skip handler — renders a ghost Skip button before the primary action. */
    onSkip?: () => void;
    /** Skip button label. */
    skipLabel?: string;
    /** The primary action (already a Button with its own label/state). */
    primary: ReactNode;
};

/**
 * The contextual footer shared by every step: an optional Back button or hint on
 * the left, and an optional ghost Skip plus the primary action on the right.
 */
export function WizardFooter({
    hint,
    onBack,
    backLabel,
    onSkip,
    skipLabel,
    primary
}: WizardFooterProps) {
    return (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
                {onBack ? (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onBack}
                        className="shadow-none"
                    >
                        <ArrowLeft />
                        {backLabel}
                    </Button>
                ) : hint ? (
                    <p className="text-sm text-muted-foreground">{hint}</p>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                {onSkip ? (
                    <Button type="button" variant="ghost" onClick={onSkip}>
                        {skipLabel}
                    </Button>
                ) : null}
                {primary}
            </div>
        </div>
    );
}
