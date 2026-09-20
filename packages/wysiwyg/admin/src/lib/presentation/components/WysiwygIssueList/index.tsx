import { defineMessages, useIntl } from 'react-intl';
import { AlertTriangle, CircleAlert } from 'lucide-react';
import { RICH_TEXT_ISSUE } from '@orthacms/content-domain';
import type {
    RichTextIssueCode,
    RichTextStructureIssue
} from '@orthacms/content-domain';
import { cn } from '@orthacms/design-system';

const messages = defineMessages({
    heading: {
        id: 'wysiwyg.issues.heading',
        defaultMessage:
            '{count, plural, one {# accessibility issue} other {# accessibility issues}}'
    },
    error: { id: 'wysiwyg.issues.error', defaultMessage: 'Blocks saving' },
    warning: { id: 'wysiwyg.issues.warning', defaultMessage: 'Worth fixing' },
    headingLevelSkipped: {
        id: 'wysiwyg.issues.headingLevelSkipped',
        defaultMessage:
            'A heading skips a level. Someone navigating by heading hears a section that isn’t there — go one level at a time.'
    },
    headingLevelInverted: {
        id: 'wysiwyg.issues.headingLevelInverted',
        defaultMessage:
            'A heading sits above the level this body starts at, so its section reads as containing the ones before it.'
    },
    headingEmpty: {
        id: 'wysiwyg.issues.headingEmpty',
        defaultMessage: 'A heading has no text, so it names nothing.'
    },
    tableMissingHeader: {
        id: 'wysiwyg.issues.tableMissingHeader',
        defaultMessage:
            'A table has no header cells. Without them a screen reader reads the values but cannot say what any of them means.'
    },
    linkTextEmpty: {
        id: 'wysiwyg.issues.linkTextEmpty',
        defaultMessage: 'A link has no text, so there is nothing to announce.'
    },
    linkTextNotDescriptive: {
        id: 'wysiwyg.issues.linkTextNotDescriptive',
        defaultMessage:
            'A link’s text doesn’t say where it goes. Links are often read out of their sentence, as a list — “click here” is then indistinguishable from every other one.'
    },
    invalidLanguageTag: {
        id: 'wysiwyg.issues.invalidLanguageTag',
        defaultMessage:
            'A language marker isn’t a valid BCP-47 tag (for example “en”, “en-GB”, “zh-Hans”), so it is ignored.'
    }
});

/** The localized explanation for each rule the kernel can report. */
const EXPLANATION: Record<RichTextIssueCode, keyof typeof messages> = {
    [RICH_TEXT_ISSUE.HeadingLevelSkipped]: 'headingLevelSkipped',
    [RICH_TEXT_ISSUE.HeadingLevelInverted]: 'headingLevelInverted',
    [RICH_TEXT_ISSUE.HeadingEmpty]: 'headingEmpty',
    [RICH_TEXT_ISSUE.TableMissingHeader]: 'tableMissingHeader',
    [RICH_TEXT_ISSUE.LinkTextEmpty]: 'linkTextEmpty',
    [RICH_TEXT_ISSUE.LinkTextNotDescriptive]: 'linkTextNotDescriptive',
    [RICH_TEXT_ISSUE.InvalidLanguageTag]: 'invalidLanguageTag'
};

/**
 * What is structurally wrong with the document, under it.
 *
 * The rules are the kernel's (`inspectRichText`) — the same ones the server
 * applies — so this list is never a second opinion: an **error** here is
 * precisely what will refuse the save, and a **warning** is precisely what will
 * not. Showing both is the point. Section 508's 504.2 asks whether an authoring
 * tool *enables* the production of conformant content, and a rule an author
 * only meets as a rejected save enables nothing; a rule they can see while
 * writing is a rule they can follow.
 *
 * Nothing renders when the document is clean, so a well-formed body costs no
 * vertical space and no attention.
 *
 * ### Announcement
 *
 * The region is polite, not assertive, and not a live *log*: findings change on
 * almost every keystroke while a heading is being retyped, and reading each
 * intermediate state aloud would talk over the author continuously. A polite
 * region waits for a pause, which is when they are between thoughts and can act
 * on it. The heading carries the count, so the change that matters — "there are
 * two problems now, there was one" — is the first thing announced.
 */
export function WysiwygIssueList({
    issues
}: {
    /** The findings on the current document; empty renders nothing. */
    issues: readonly RichTextStructureIssue[];
}) {
    const intl = useIntl();
    if (issues.length === 0) return null;

    return (
        <div
            className="border-t border-border px-6 py-3"
            aria-live="polite"
            aria-atomic="false"
        >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
                {intl.formatMessage(messages.heading, {
                    count: issues.length
                })}
            </p>
            <ul className="flex flex-col gap-1.5">
                {issues.map((issue, index) => {
                    const blocking = issue.severity === 'error';
                    const Icon = blocking ? CircleAlert : AlertTriangle;
                    return (
                        <li
                            // A document can carry two of the same finding (two
                            // header-less tables), and neither the code nor the
                            // message distinguishes them — the position in the
                            // list is what does. The list is derived fresh from
                            // the document on every change and holds no state
                            // of its own, so an index key costs nothing here.
                            key={`${issue.code}-${index}`}
                            className={cn(
                                'flex items-start gap-2 text-xs',
                                blocking
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                            )}
                        >
                            <Icon
                                aria-hidden
                                className="mt-px size-3.5 shrink-0"
                            />
                            <span>
                                {intl.formatMessage(
                                    messages[EXPLANATION[issue.code]]
                                )}{' '}
                                <span className="opacity-70">
                                    {intl.formatMessage(
                                        blocking
                                            ? messages.error
                                            : messages.warning
                                    )}{' '}
                                    · WCAG {issue.wcag}
                                </span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
