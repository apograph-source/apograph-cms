import { useMemo, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useContentTypes } from '@orthacms/content-admin';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    SkeletonRegion,
    Skeleton
} from '@orthacms/design-system';
import { protectedTypeRows } from '../../../domain/protectedTypeRows';
import type { ProtectedTypeRow } from '../../../domain/types';
import { useProtectionRules } from '../../../application/hooks';
import { RuleEditorDialog } from './RuleEditorDialog';

const messages = defineMessages({
    title: {
        id: 'protection.settings.title',
        defaultMessage: 'Publication protection'
    },
    description: {
        id: 'protection.settings.description',
        defaultMessage:
            'A protected type needs approvals before an entry can be published. Drafts are edited freely — publication is protected, not the record.'
    },
    loading: {
        id: 'protection.settings.loading',
        defaultMessage: 'Loading protection rules'
    },
    deniedTitle: {
        id: 'protection.settings.deniedTitle',
        defaultMessage: 'You cannot manage protection'
    },
    deniedBody: {
        id: 'protection.settings.deniedBody',
        defaultMessage:
            'Managing protection rules is an administrator’s job. You can still see whether an entry needs review from the entry itself.'
    },
    errorTitle: {
        id: 'protection.settings.errorTitle',
        defaultMessage: 'Protection rules could not be loaded'
    },
    errorBody: {
        id: 'protection.settings.errorBody',
        defaultMessage:
            'This is not the same as “nothing is protected” — try again in a moment.'
    },
    emptyTitle: {
        id: 'protection.settings.emptyTitle',
        defaultMessage: 'No publishable content types'
    },
    emptyBody: {
        id: 'protection.settings.emptyBody',
        defaultMessage:
            'Protection guards the step from draft to published, so it applies only to types that have one. Grant this workspace a publishable type on the Content tab.'
    },
    unprotected: {
        id: 'protection.settings.unprotected',
        defaultMessage: 'Not protected'
    },
    off: { id: 'protection.settings.off', defaultMessage: 'Switched off' },
    approvals: {
        id: 'protection.settings.approvals',
        defaultMessage: '{count, plural, one {# approval} other {# approvals}}'
    },
    configure: {
        id: 'protection.settings.configure',
        defaultMessage: 'Configure'
    },
    view: { id: 'protection.settings.view', defaultMessage: 'View' },
    configureFor: {
        id: 'protection.settings.configureFor',
        defaultMessage: 'Configure protection for {label}'
    },
    orphanTitle: {
        id: 'protection.settings.orphanTitle',
        defaultMessage: 'Rules on types this workspace no longer has'
    },
    orphanBody: {
        id: 'protection.settings.orphanBody',
        defaultMessage:
            'These rules protect content types the workspace was granted once. They do nothing now, and removing the grant did not remove them.'
    }
});

/**
 * The workspace settings **Protection** tab.
 *
 * **The list is the workspace's content grants, not its rules.** A rule is
 * addressed by `(workspace, kind, slug)` — the same pair `workspace_content`
 * grants — so there is no type picker here and nothing to keep in step: a type
 * appears because the workspace may work with it, and its rule is a property of
 * the row rather than the reason for it.
 *
 * Everything is `protection:manage`, administrator-only, and that includes the
 * **read**: the list route is gated the same way the writes are, because nobody
 * but an administrator needs the rule table. A member without it is told so
 * rather than shown an empty list they would read as "nothing is protected".
 */
export function ProtectionSettings() {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const canManage = useHasPermission('protection:manage');
    const rules = useProtectionRules(workspace.id, canManage);
    const types = useContentTypes();
    const [editing, setEditing] = useState<ProtectedTypeRow | null>(null);
    // Captured on the click rather than read off Radix: the dialog unmounts
    // with `editing`, so its own restore never runs.
    const trigger = useRef<HTMLElement | null>(null);

    const { rows, orphans } = useMemo(
        () =>
            protectedTypeRows(
                workspace.content,
                types.data ?? [],
                rules.data ?? []
            ),
        [workspace.content, types.data, rules.data]
    );

    if (!canManage) {
        return (
            <Alert>
                <AlertTitle>
                    {intl.formatMessage(messages.deniedTitle)}
                </AlertTitle>
                <AlertDescription>
                    {intl.formatMessage(messages.deniedBody)}
                </AlertDescription>
            </Alert>
        );
    }

    if (rules.isPending || types.isPending) {
        return (
            <SkeletonRegion label={intl.formatMessage(messages.loading)}>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="mt-2 h-24 w-full" />
            </SkeletonRegion>
        );
    }

    // A failed read is not an empty one: "nothing is protected" is a claim
    // about the workspace, and making it when the truth is "we could not ask"
    // is how somebody concludes a rule they set is gone.
    if (rules.isError || types.isError) {
        return (
            <Alert variant="destructive">
                <AlertTitle>
                    {intl.formatMessage(messages.errorTitle)}
                </AlertTitle>
                <AlertDescription>
                    {intl.formatMessage(messages.errorBody)}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>{intl.formatMessage(messages.title)}</CardTitle>
                    <CardDescription>
                        {intl.formatMessage(messages.description)}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {rows.length === 0 ? (
                        <div className="p-6">
                            <p className="text-sm font-medium">
                                {intl.formatMessage(messages.emptyTitle)}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {intl.formatMessage(messages.emptyBody)}
                            </p>
                        </div>
                    ) : (
                        <ul className="divide-y">
                            {rows.map((row) => (
                                <li
                                    key={row.slug}
                                    className="flex items-center justify-between gap-4 px-6 py-4"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">
                                            {row.label}
                                        </div>
                                        <div className="truncate font-mono text-xs text-muted-foreground">
                                            {row.slug} · {row.kind}
                                        </div>
                                    </div>
                                    <div className="flex flex-none items-center gap-3">
                                        {/* Text, never colour alone. */}
                                        <Badge
                                            variant={
                                                row.rule?.enabled
                                                    ? 'default'
                                                    : 'secondary'
                                            }
                                        >
                                            {row.rule?.enabled
                                                ? intl.formatMessage(
                                                      messages.approvals,
                                                      {
                                                          count: row.rule
                                                              .requiredApprovals
                                                      }
                                                  )
                                                : intl.formatMessage(
                                                      row.rule
                                                          ? messages.off
                                                          : messages.unprotected
                                                  )}
                                        </Badge>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={(event) => {
                                                trigger.current =
                                                    event.currentTarget;
                                                setEditing(row);
                                            }}
                                            aria-label={intl.formatMessage(
                                                messages.configureFor,
                                                { label: row.label }
                                            )}
                                        >
                                            {intl.formatMessage(
                                                messages.configure
                                            )}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {orphans.length > 0 ? (
                <Alert className="mt-6">
                    <AlertTitle>
                        {intl.formatMessage(messages.orphanTitle)}
                    </AlertTitle>
                    <AlertDescription>
                        <p>{intl.formatMessage(messages.orphanBody)}</p>
                        <ul className="mt-2 space-y-2">
                            {orphans.map((rule) => (
                                <li
                                    key={rule.id}
                                    className="flex items-center justify-between gap-3"
                                >
                                    <span className="font-mono text-xs">
                                        {rule.slug} · {rule.kind}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={(event) => {
                                            trigger.current =
                                                event.currentTarget;
                                            setEditing({
                                                slug: rule.slug,
                                                kind: rule.kind,
                                                label: rule.slug,
                                                rule
                                            });
                                        }}
                                    >
                                        {intl.formatMessage(messages.configure)}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            ) : null}

            {editing ? (
                <RuleEditorDialog
                    open
                    onOpenChange={(next) => !next && setEditing(null)}
                    row={editing}
                    workspaceId={workspace.id}
                    memberCount={workspace.members.length}
                    canManage={canManage}
                    returnFocusTo={trigger}
                />
            ) : null}
        </>
    );
}
