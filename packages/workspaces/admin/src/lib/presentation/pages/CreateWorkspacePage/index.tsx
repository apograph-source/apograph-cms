import { useEffect, useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link, Navigate } from 'react-router-dom';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageTopBar } from '@orthacms/shell-admin';
import { ArrowLeft, ArrowRight, Layers } from 'lucide-react';
import {
    Button,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    Container,
    ContainerHeader,
    Spinner,
    Stepper,
    WizardFooter,
    WizardStepCard
} from '@orthacms/design-system';
import { useDocumentTitle } from '@orthacms/utils-admin';
import { useCreateWorkspaceFlow } from '../../../application/useCreateWorkspaceFlow';
import { ContentStep } from '../../components/CreateWorkspaceWizard/ContentStep';
import { IdentityFields } from '../../components/CreateWorkspaceWizard/IdentityFields';
import { MembersStep } from '../../components/CreateWorkspaceWizard/MembersStep';
import { useSlug } from '../../hooks/useSlug';
import { useWizard } from '../../hooks/useWizard';
import { SlugStatus } from '../../../domain/types/wizard';
import { EMPTY_SELECTION } from '../../../domain/resourceSelection';

const messages = defineMessages({
    title: {
        id: 'workspaces.create.title',
        defaultMessage: 'Create workspace'
    },
    subtitle: {
        id: 'workspaces.create.subtitle',
        defaultMessage:
            'Set up a new workspace in three short steps. You can change most settings later.'
    },
    back: {
        id: 'workspaces.create.backToWorkspaces',
        defaultMessage: 'Back to workspaces'
    },
    crumbWorkspaces: {
        id: 'workspaces.create.crumbWorkspaces',
        defaultMessage: 'Workspaces'
    },
    // Rail
    stepBasics: {
        id: 'workspaces.create.stepBasics',
        defaultMessage: 'Basics'
    },
    stepBasicsHint: {
        id: 'workspaces.create.stepBasicsHint',
        defaultMessage: 'Name, slug, and description'
    },
    stepMembers: {
        id: 'workspaces.create.stepMembers',
        defaultMessage: 'Members'
    },
    stepMembersHint: {
        id: 'workspaces.create.stepMembersHint',
        defaultMessage: 'Who can access the workspace'
    },
    stepContent: {
        id: 'workspaces.create.stepContent',
        defaultMessage: 'Content'
    },
    stepContentHint: {
        id: 'workspaces.create.stepContentHint',
        defaultMessage: 'Collections and pages'
    },
    summaryJustYou: {
        id: 'workspaces.create.summaryMembers',
        defaultMessage: '{count, plural, one {Just you} other {# people}}'
    },
    summaryAllContent: {
        id: 'workspaces.create.summaryAllContent',
        defaultMessage: 'All content'
    },
    summarySpecificContent: {
        id: 'workspaces.create.summarySpecificContent',
        defaultMessage: '{collections} collections · {pages} pages'
    },
    stepperOptional: {
        id: 'workspaces.create.stepper.optional',
        defaultMessage: 'Optional'
    },
    stepperStepLabel: {
        id: 'workspaces.create.stepper.stepLabel',
        defaultMessage: 'Step {number}: {label}'
    },
    stepAnnouncement: {
        id: 'workspaces.create.stepAnnouncement',
        defaultMessage: 'Step {number} of {total}: {label}.'
    },
    // Step cards
    basicsTitle: {
        id: 'workspaces.create.basicsCardTitle',
        defaultMessage: 'Basics'
    },
    basicsDescription: {
        id: 'workspaces.create.basicsCardDescription',
        defaultMessage: 'Name your workspace and give it an identity.'
    },
    membersTitle: {
        id: 'workspaces.create.membersCardTitle',
        defaultMessage: 'Members'
    },
    membersDescription: {
        id: 'workspaces.create.membersCardDescription',
        defaultMessage:
            'Add teammates now, or skip and invite them later. You are the owner.'
    },
    contentTitle: {
        id: 'workspaces.create.contentCardTitle',
        defaultMessage: 'Content access'
    },
    contentDescription: {
        id: 'workspaces.create.contentCardDescription',
        defaultMessage: 'Choose what this workspace can access.'
    },
    // Footer
    basicsHint: {
        id: 'workspaces.create.basicsFooterHint',
        defaultMessage:
            'Only a name is required — everything else can change later.'
    },
    continueToMembers: {
        id: 'workspaces.create.continueToMembers',
        defaultMessage: 'Continue to members'
    },
    continueToContent: {
        id: 'workspaces.create.continueToContent',
        defaultMessage: 'Continue to content'
    },
    backLabel: {
        id: 'workspaces.create.back',
        defaultMessage: 'Back'
    },
    skipForNow: {
        id: 'workspaces.create.skipForNow',
        defaultMessage: 'Skip for now'
    },
    skipAndCreate: {
        id: 'workspaces.create.skipAndCreate',
        defaultMessage: 'Skip & create'
    },
    create: {
        id: 'workspaces.create.create',
        defaultMessage: 'Create workspace'
    },
    creating: {
        id: 'workspaces.create.creating',
        defaultMessage: 'Creating…'
    }
});

/**
 * Full-page wizard for creating a workspace. Owns navigation and submission;
 * all form state lives in {@link useWizard}, and each step body is
 * presentational. Rendered at `/workspaces/new` inside the authenticated shell.
 */
export function CreateWorkspacePage() {
    const intl = useIntl();
    const stepTitleRef = useRef<HTMLHeadingElement>(null);
    useDocumentTitle(intl.formatMessage(messages.title));
    const canCreate = useHasPermission('workspaces:create');
    const wizard = useWizard();
    const flow = useCreateWorkspaceFlow();
    const slug = useSlug({ data: wizard.data, update: wizard.update });

    // `WizardStepCard` is keyed on the step so the entrance animation replays —
    // which unmounts the button the user just pressed and drops focus to
    // <body>, making every step change restart Tab at the top of the document.
    // Move focus to the new card's heading instead. `previousStep` keeps this to
    // real step *changes*: stealing focus on first paint would be its own bug.
    const previousStep = useRef(wizard.step);
    useEffect(() => {
        if (previousStep.current === wizard.step) return;
        previousStep.current = wizard.step;
        stepTitleRef.current?.focus();
    }, [wizard.step]);

    // The server enforces `workspaces:create`; redirect rather than render the
    // wizard for users who can't create one (e.g. deep-linking to
    // `/workspaces/new`). Auth is already resolved here — this route renders
    // inside the shell's `RequireAuth`, so `canCreate` reflects real grants.
    if (!canCreate) {
        return (
            <Navigate
                to="/workspaces"
                replace
                // Tell the list why it's showing instead of the wizard, so the
                // redirect isn't silent for a screen-reader user.
                state={{ redirectNotice: 'create-denied' }}
            />
        );
    }

    const basicsCanContinue =
        wizard.basicsValid && slug.status === SlugStatus.Available;
    const contentBlocked =
        wizard.contentMode === 'specific' &&
        (wizard.ctLoading || wizard.ctError);
    // `useWizard` already falls back to step 1 when the basics are incomplete,
    // so this is defense in depth: submitting without a name/slug can only ever
    // throw inside the `Slug` guard and surface as a generic failure, which
    // reads as "the server refused" when nothing was ever sent.
    const createBlocked =
        flow.submitting || contentBlocked || !wizard.basicsValid;

    // Submission (slug VO validation → create → toast + navigate) lives in the
    // create use-case hook; the page only assembles the snapshot. "Skip &
    // create" submits an override with empty content without mutating state.
    // Both entry points share the incomplete-basics guard: `WizardFooter`'s Skip
    // takes no disabled state, so refusing here is what stops it submitting a
    // snapshot that can only fail.
    const submitTo = (skip: boolean) => {
        if (createBlocked) return Promise.resolve();
        return flow.submit(
            skip
                ? {
                      ...wizard.snapshot,
                      contentMode: 'specific',
                      collections: EMPTY_SELECTION,
                      pages: EMPTY_SELECTION
                  }
                : wizard.snapshot
        );
    };

    const railSteps = [
        {
            label: intl.formatMessage(messages.stepBasics),
            hint: intl.formatMessage(messages.stepBasicsHint),
            summary: wizard.data.name.trim() || undefined
        },
        {
            label: intl.formatMessage(messages.stepMembers),
            hint: intl.formatMessage(messages.stepMembersHint),
            optional: true,
            summary: intl.formatMessage(messages.summaryJustYou, {
                count: wizard.memberCount
            })
        },
        {
            label: intl.formatMessage(messages.stepContent),
            hint: intl.formatMessage(messages.stepContentHint),
            optional: true,
            summary:
                wizard.contentMode === 'all'
                    ? intl.formatMessage(messages.summaryAllContent)
                    : intl.formatMessage(messages.summarySpecificContent, {
                          collections: wizard.collectionCount,
                          pages: wizard.pageCount
                      })
        }
    ];

    return (
        <>
            <PageTopBar
                icon={Layers}
                iconClassName="bg-violet-soft text-violet-soft-foreground"
                crumbs={[
                    {
                        key: 'workspaces',
                        label: intl.formatMessage(messages.crumbWorkspaces),
                        to: '/workspaces'
                    },
                    {
                        key: 'new',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container className="max-w-[920px]">
                <Link
                    to="/workspaces"
                    className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="size-4" />
                    {intl.formatMessage(messages.back)}
                </Link>

                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                />

                <div className="grid gap-8 lg:grid-cols-[244px_1fr]">
                    <div className="lg:sticky lg:top-6 lg:self-start">
                        <Stepper
                            current={wizard.step}
                            maxReached={wizard.maxReached}
                            steps={railSteps}
                            onStepClick={wizard.goStep}
                            optionalLabel={intl.formatMessage(
                                messages.stepperOptional
                            )}
                            stepAriaLabel={(step, number) =>
                                intl.formatMessage(messages.stepperStepLabel, {
                                    number,
                                    label: step.label
                                })
                            }
                        />
                    </div>

                    {/* The rail updates visually only, and the heading swap is
                        silent; restate where the user now is. Focus moving to
                        the new heading covers most screen readers, but the
                        progress ("2 of 3") lives only in the rail's styling. */}
                    <span role="status" aria-live="polite" className="sr-only">
                        {intl.formatMessage(messages.stepAnnouncement, {
                            number: wizard.step,
                            total: railSteps.length,
                            label: railSteps[wizard.step - 1]?.label ?? ''
                        })}
                    </span>

                    <WizardStepCard key={wizard.step}>
                        {wizard.step === 1 ? (
                            <>
                                <CardHeader>
                                    <CardTitle asChild>
                                        {/* A real <h2> under the page's <h1>:
                                            it gives the step card a place in the
                                            heading outline, and it is the focus
                                            target on a step change. */}
                                        <h2
                                            ref={stepTitleRef}
                                            tabIndex={-1}
                                            className="focus-visible:outline-none"
                                        >
                                            {intl.formatMessage(
                                                messages.basicsTitle
                                            )}
                                        </h2>
                                    </CardTitle>
                                    <CardDescription>
                                        {intl.formatMessage(
                                            messages.basicsDescription
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <IdentityFields
                                        data={wizard.data}
                                        update={wizard.update}
                                        slug={slug}
                                    />
                                </CardContent>
                                <CardFooter>
                                    <WizardFooter
                                        hint={intl.formatMessage(
                                            messages.basicsHint
                                        )}
                                        primary={
                                            <Button
                                                type="button"
                                                onClick={() => wizard.goStep(2)}
                                                disabled={!basicsCanContinue}
                                            >
                                                {intl.formatMessage(
                                                    messages.continueToMembers
                                                )}
                                                <ArrowRight />
                                            </Button>
                                        }
                                    />
                                </CardFooter>
                            </>
                        ) : null}

                        {wizard.step === 2 ? (
                            <>
                                <CardHeader>
                                    <CardTitle asChild>
                                        {/* A real <h2> under the page's <h1>:
                                            it gives the step card a place in the
                                            heading outline, and it is the focus
                                            target on a step change. */}
                                        <h2
                                            ref={stepTitleRef}
                                            tabIndex={-1}
                                            className="focus-visible:outline-none"
                                        >
                                            {intl.formatMessage(
                                                messages.membersTitle
                                            )}
                                        </h2>
                                    </CardTitle>
                                    <CardDescription>
                                        {intl.formatMessage(
                                            messages.membersDescription
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <MembersStep
                                        members={wizard.members}
                                        addMember={wizard.addMember}
                                        removeMember={wizard.removeMember}
                                    />
                                </CardContent>
                                <CardFooter>
                                    <WizardFooter
                                        onBack={() => wizard.goStep(1)}
                                        backLabel={intl.formatMessage(
                                            messages.backLabel
                                        )}
                                        onSkip={() => wizard.goStep(3)}
                                        skipLabel={intl.formatMessage(
                                            messages.skipForNow
                                        )}
                                        primary={
                                            <Button
                                                type="button"
                                                onClick={() => wizard.goStep(3)}
                                            >
                                                {intl.formatMessage(
                                                    messages.continueToContent
                                                )}
                                                <ArrowRight />
                                            </Button>
                                        }
                                    />
                                </CardFooter>
                            </>
                        ) : null}

                        {wizard.step === 3 ? (
                            <>
                                <CardHeader>
                                    <CardTitle asChild>
                                        {/* A real <h2> under the page's <h1>:
                                            it gives the step card a place in the
                                            heading outline, and it is the focus
                                            target on a step change. */}
                                        <h2
                                            ref={stepTitleRef}
                                            tabIndex={-1}
                                            className="focus-visible:outline-none"
                                        >
                                            {intl.formatMessage(
                                                messages.contentTitle
                                            )}
                                        </h2>
                                    </CardTitle>
                                    <CardDescription>
                                        {intl.formatMessage(
                                            messages.contentDescription
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ContentStep
                                        contentMode={wizard.contentMode}
                                        setContentMode={wizard.setContentMode}
                                        collections={wizard.collections}
                                        setCollections={wizard.setCollections}
                                        pages={wizard.pages}
                                        setPages={wizard.setPages}
                                    />
                                </CardContent>
                                <CardFooter>
                                    <WizardFooter
                                        onBack={() => wizard.goStep(2)}
                                        backLabel={intl.formatMessage(
                                            messages.backLabel
                                        )}
                                        onSkip={() => submitTo(true)}
                                        skipLabel={intl.formatMessage(
                                            messages.skipAndCreate
                                        )}
                                        primary={
                                            <Button
                                                type="button"
                                                onClick={() => submitTo(false)}
                                                disabled={createBlocked}
                                            >
                                                {flow.submitting ? (
                                                    <>
                                                        <Spinner />
                                                        {intl.formatMessage(
                                                            messages.creating
                                                        )}
                                                    </>
                                                ) : (
                                                    intl.formatMessage(
                                                        messages.create
                                                    )
                                                )}
                                            </Button>
                                        }
                                    />
                                </CardFooter>
                            </>
                        ) : null}
                    </WizardStepCard>
                </div>
            </Container>
        </>
    );
}
