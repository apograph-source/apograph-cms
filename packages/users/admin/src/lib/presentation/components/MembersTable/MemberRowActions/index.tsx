import { useId, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Activity,
    Ban,
    Building2,
    CircleCheck,
    KeyRound,
    MonitorSmartphone,
    MoreHorizontal,
    Send,
    ShieldCheck,
    Trash2,
    UserRound
} from 'lucide-react';
import { useAuth, useHasPermission } from '@apograph/identity-admin';
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn,
    toast
} from '@apograph/design-system';
import { inviteLinkFor } from '../../../../infrastructure/inviteLink';
import { InviteLinkDialog } from '../../InviteLinkDialog';
import { MEMBERS_RESULTS_ANCHOR_ID } from '../../../membersResultsAnchor';
import { useResendInvite } from '../../../../application/useResendInvite';
import { useRevokeInvite } from '../../../../application/useRevokeInvite';
import { useSetMemberStatus } from '../../../../application/useSetMemberStatus';
import { MemberEntity } from '../../../../domain/member';
import type { Member } from '../../../../domain/types/member';

/** Intl descriptors for {@link MemberRowActions}, co-located with the component. */
const messages = defineMessages({
    open: {
        id: 'users.actions.open',
        defaultMessage: 'Actions for {name}'
    },
    account: {
        id: 'users.actions.account',
        defaultMessage: 'Account'
    },
    audit: {
        id: 'users.actions.audit',
        defaultMessage: 'Audit'
    },
    access: {
        id: 'users.actions.access',
        defaultMessage: 'Access'
    },
    general: {
        id: 'users.actions.general',
        defaultMessage: 'General'
    },
    role: {
        id: 'users.actions.role',
        defaultMessage: 'Role'
    },
    workspaces: {
        id: 'users.actions.workspaces',
        defaultMessage: 'Workspaces'
    },
    sessions: {
        id: 'users.actions.sessions',
        defaultMessage: 'Sessions'
    },
    activity: {
        id: 'users.actions.activity',
        defaultMessage: 'Activity'
    },
    signInAccess: {
        id: 'users.actions.signInAccess',
        defaultMessage: 'Sign-in access'
    },
    disable: {
        id: 'users.actions.disable',
        defaultMessage: 'Disable'
    },
    enable: {
        id: 'users.actions.enable',
        defaultMessage: 'Enable'
    },
    resend: {
        id: 'users.actions.resend',
        defaultMessage: 'Resend invite'
    },
    revoke: {
        id: 'users.actions.revoke',
        defaultMessage: 'Revoke invite'
    },
    disableSelf: {
        id: 'users.actions.disableSelf',
        defaultMessage: 'You cannot disable your own account.'
    },
    disableLastAdmin: {
        id: 'users.actions.disableLastAdmin',
        defaultMessage:
            'The last remaining admin cannot be disabled. Promote another member to admin first.'
    },
    disabled: {
        id: 'users.actions.disabled.toast',
        defaultMessage: 'Disabled {name}'
    },
    enabled: {
        id: 'users.actions.enabled.toast',
        defaultMessage: 'Enabled {name}'
    },

    inviteMailed: {
        id: 'users.actions.inviteMailed.toast',
        defaultMessage: 'A fresh invitation is on its way to {email}.'
    },
    revoked: {
        id: 'users.actions.revoked.toast',
        defaultMessage: 'Revoked the invite for {email}'
    },
    actionFailed: {
        id: 'users.actions.failed.toast',
        defaultMessage: 'Something went wrong. Please try again.'
    },
    confirmDisableTitle: {
        id: 'users.actions.confirmDisable.title',
        defaultMessage: 'Disable {name}?'
    },
    confirmDisableBody: {
        id: 'users.actions.confirmDisable.body',
        defaultMessage:
            '{email} will be signed out everywhere and blocked from signing in until you enable them again. Their workspace memberships and authored content are kept.'
    },
    confirmRevokeTitle: {
        id: 'users.actions.confirmRevoke.title',
        defaultMessage: 'Delete this invite permanently?'
    },
    confirmRevokeBody: {
        id: 'users.actions.confirmRevoke.body',
        defaultMessage:
            'The pending account for {email} and its workspace assignments are deleted. This cannot be undone — you would have to invite them again and re-choose their workspaces.'
    },
    confirmRevokeAction: {
        id: 'users.actions.confirmRevoke.action',
        defaultMessage: 'Delete invite'
    }
});

type MenuIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/**
 * The row-end kebab menu. It mirrors the user detail page's side rail: an
 * **Account** group (General / Role / Workspaces) that every reader sees, then
 * permission-gated **Audit** (Sessions / Activity) and **Access** (Sign-in
 * access) groups — each item navigates straight to that tab. Below a separator
 * sit the status quick actions: a pending invite offers Resend / Revoke, an
 * active member Disable, a disabled member Enable, each shown only with its
 * `users:*` permission. The guardrailed Disable (yourself, the sole admin)
 * stays visible but inert with a tooltip. (Clicking the row itself also opens
 * the member — see {@link MembersTable}.)
 */
export function MemberRowActions({ member }: { member: Member }) {
    const intl = useIntl();
    const navigate = useNavigate();
    const { user } = useAuth();
    const canUpdate = useHasPermission('users:update');
    const canInvite = useHasPermission('users:create');
    const canRevoke = useHasPermission('users:delete');
    const canReadActivity = useHasPermission('activity:read');

    const setStatus = useSetMemberStatus();
    const resendInvite = useResendInvite();
    const revokeInvite = useRevokeInvite();

    // The rotated link, held only until the dialog is dismissed. Resending
    // invalidates whatever link the invitee already had, so the new one has to
    // be handed over — until a mailer exists, by the admin (identity epic #11).
    const [rotatedLink, setRotatedLink] = useState<string | null>(null);

    // Which destructive action is awaiting confirmation. Both of these are
    // irreversible from the UI — revoking deletes the pending account outright —
    // so neither fires straight off a menu selection (WCAG 3.3.4).
    const [confirming, setConfirming] = useState<'disable' | 'revoke' | null>(
        null
    );

    const failed = () => toast.error(intl.formatMessage(messages.actionFailed));
    const base = `/users/${member.id}`;
    const kebabId = `member-actions-${member.id}`;

    /**
     * Put focus back on a stable anchor after an overlay closes. Radix restores
     * focus to whatever opened it, but a row-removing mutation unmounts that
     * trigger mid-flight and focus lands on `<body>` — restarting a keyboard
     * user at the top of the document after every action (WCAG 2.4.3). Deferred
     * a frame so this runs after Radix's own restoration rather than racing it.
     */
    const restoreFocusTo = (selector: string) => {
        requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(selector)?.focus();
        });
    };

    /** The row survives this action, so focus belongs back on its own kebab. */
    const focusKebab = () => restoreFocusTo(`#${CSS.escape(kebabId)}`);

    /**
     * The row is gone; fall back to the roster's results region. It wraps every
     * result state, so it is still mounted even when removing this row emptied
     * the table and swapped it for the empty state.
     */
    const focusResults = () => restoreFocusTo(`#${MEMBERS_RESULTS_ANCHOR_ID}`);

    /** A navigation item that routes to one of the member's detail tabs. */
    const navItem = (
        key: string,
        icon: MenuIcon,
        label: string,
        to: string
    ): ReactNode => {
        const Icon = icon;
        return (
            <DropdownMenuItem key={key} onSelect={() => navigate(to)}>
                <Icon aria-hidden />
                {label}
            </DropdownMenuItem>
        );
    };

    // Quick status actions, mirroring the member's lifecycle.
    let quickItems: ReactNode[] = [];
    let destructiveItem: ReactNode = null;

    if (member.status === 'pending') {
        quickItems = [
            canInvite ? (
                <DropdownMenuItem
                    key="resend"
                    onSelect={() =>
                        resendInvite.mutate(member.id, {
                            onSuccess: (invited) => {
                                // No token means the server emailed the fresh
                                // link and kept the only copy (ADR-0018 §4);
                                // there is nothing to hand over by clipboard.
                                if (!invited.inviteToken) {
                                    toast.success(
                                        intl.formatMessage(
                                            messages.inviteMailed,
                                            { email: member.email }
                                        )
                                    );
                                    return;
                                }
                                setRotatedLink(
                                    inviteLinkFor(invited.inviteToken)
                                );
                            },
                            onError: failed
                        })
                    }
                >
                    <Send aria-hidden />
                    {intl.formatMessage(messages.resend)}
                </DropdownMenuItem>
            ) : null
        ];
        destructiveItem = canRevoke ? (
            <DropdownMenuItem
                key="revoke"
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirming('revoke')}
            >
                <Trash2 aria-hidden />
                {intl.formatMessage(messages.revoke)}
            </DropdownMenuItem>
        ) : null;
    } else if (member.status === 'active') {
        // The Member entity mirrors the server's guardrails (self, sole admin)
        // so the item can disable itself with a reason instead of failing.
        const removal = MemberEntity.of(member).canBeRemoved(user?.id);
        const disableBlockedReason = removal.ok
            ? null
            : intl.formatMessage(
                  removal.reason === 'self'
                      ? messages.disableSelf
                      : messages.disableLastAdmin
              );

        quickItems = [
            canUpdate ? (
                <GuardedMenuItem
                    key="disable"
                    blockedReason={disableBlockedReason}
                    onSelect={() => setConfirming('disable')}
                >
                    <Ban aria-hidden />
                    {intl.formatMessage(messages.disable)}
                </GuardedMenuItem>
            ) : null
        ];
    } else {
        quickItems = [
            canUpdate ? (
                <DropdownMenuItem
                    key="enable"
                    onSelect={() =>
                        setStatus.mutate(
                            { id: member.id, disabled: false },
                            {
                                onSuccess: () =>
                                    toast.success(
                                        intl.formatMessage(messages.enabled, {
                                            name: member.name
                                        })
                                    ),
                                onError: failed
                            }
                        )
                    }
                >
                    <CircleCheck aria-hidden />
                    {intl.formatMessage(messages.enable)}
                </DropdownMenuItem>
            ) : null
        ];
    }

    const visibleQuick = quickItems.filter(Boolean);
    const hasQuick = visibleQuick.length > 0 || destructiveItem;

    /** Delete the pending account. The row goes with it, so focus the table. */
    const confirmRevoke = () =>
        revokeInvite.mutate(member.id, {
            onSuccess: () => {
                setConfirming(null);
                focusResults();
                toast.success(
                    intl.formatMessage(messages.revoked, {
                        email: member.email
                    })
                );
            },
            onError: () => {
                setConfirming(null);
                focusKebab();
                failed();
            }
        });

    /** Suspend sign-in. The row stays (its pill flips), so focus its kebab. */
    const confirmDisable = () =>
        setStatus.mutate(
            { id: member.id, disabled: true },
            {
                onSuccess: () => {
                    setConfirming(null);
                    focusKebab();
                    toast.success(
                        intl.formatMessage(messages.disabled, {
                            name: member.name
                        })
                    );
                },
                onError: () => {
                    setConfirming(null);
                    focusKebab();
                    failed();
                }
            }
        );

    const confirmBusy = revokeInvite.isPending || setStatus.isPending;

    return (
        <>
            {/* `modal={false}` so the open menu doesn't aria-hide the page root
            (which holds focusable content) — a row menu needs no background
            trap. */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <Button
                        id={kebabId}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={intl.formatMessage(messages.open, {
                            name: member.name
                        })}
                    >
                        <MoreHorizontal aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>
                            {intl.formatMessage(messages.account)}
                        </DropdownMenuLabel>
                        {navItem(
                            'general',
                            UserRound,
                            intl.formatMessage(messages.general),
                            `${base}/general`
                        )}
                        {navItem(
                            'role',
                            ShieldCheck,
                            intl.formatMessage(messages.role),
                            `${base}/roles`
                        )}
                        {navItem(
                            'workspaces',
                            Building2,
                            intl.formatMessage(messages.workspaces),
                            `${base}/workspaces`
                        )}
                    </DropdownMenuGroup>

                    {canUpdate || canReadActivity ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                    {intl.formatMessage(messages.audit)}
                                </DropdownMenuLabel>
                                {canUpdate
                                    ? navItem(
                                          'sessions',
                                          MonitorSmartphone,
                                          intl.formatMessage(messages.sessions),
                                          `${base}/sessions`
                                      )
                                    : null}
                                {canReadActivity
                                    ? navItem(
                                          'activity',
                                          Activity,
                                          intl.formatMessage(messages.activity),
                                          `${base}/activity`
                                      )
                                    : null}
                            </DropdownMenuGroup>
                        </>
                    ) : null}

                    {canUpdate ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                    {intl.formatMessage(messages.access)}
                                </DropdownMenuLabel>
                                {navItem(
                                    'access',
                                    KeyRound,
                                    intl.formatMessage(messages.signInAccess),
                                    `${base}/access`
                                )}
                            </DropdownMenuGroup>
                        </>
                    ) : null}

                    {hasQuick ? (
                        <>
                            <DropdownMenuSeparator />
                            {visibleQuick.length > 0 ? (
                                <DropdownMenuGroup>
                                    {visibleQuick}
                                </DropdownMenuGroup>
                            ) : null}
                            {destructiveItem ? (
                                <DropdownMenuGroup>
                                    {destructiveItem}
                                </DropdownMenuGroup>
                            ) : null}
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            <InviteLinkDialog
                link={rotatedLink}
                email={member.email}
                open={rotatedLink !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRotatedLink(null);
                        // The row is still here — Radix can't restore focus to
                        // the kebab because the menu that opened this dialog has
                        // already unmounted, so do it explicitly.
                        focusKebab();
                    }
                }}
            />

            <ConfirmDialog
                open={confirming !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setConfirming(null);
                        focusKebab();
                    }
                }}
                busy={confirmBusy}
                title={intl.formatMessage(
                    confirming === 'revoke'
                        ? messages.confirmRevokeTitle
                        : messages.confirmDisableTitle,
                    { name: member.name }
                )}
                description={intl.formatMessage(
                    confirming === 'revoke'
                        ? messages.confirmRevokeBody
                        : messages.confirmDisableBody,
                    { email: member.email }
                )}
                confirmLabel={intl.formatMessage(
                    confirming === 'revoke'
                        ? messages.confirmRevokeAction
                        : messages.disable
                )}
                confirmVariant="destructive"
                onConfirm={
                    confirming === 'revoke' ? confirmRevoke : confirmDisable
                }
            />
        </>
    );
}

/**
 * A menu item that a guardrail can veto. When `blockedReason` is set the item
 * stays visible but inert — styled disabled, `aria-disabled`, selection
 * suppressed — and a tooltip carries the reason. Radix's real `disabled`
 * suppresses the pointer/focus events tooltips need, hence the manual
 * treatment.
 */
function GuardedMenuItem({
    blockedReason,
    onSelect,
    children
}: {
    blockedReason: string | null;
    onSelect: () => void;
    children: ReactNode;
}) {
    const reasonId = useId();

    if (!blockedReason) {
        return (
            <DropdownMenuItem onSelect={onSelect}>{children}</DropdownMenuItem>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <DropdownMenuItem
                    aria-disabled
                    aria-describedby={reasonId}
                    className={cn('opacity-50 focus:bg-transparent')}
                    onSelect={(event) => event.preventDefault()}
                >
                    {children}
                    {/* Voiced as the item's description so a screen-reader user
                        hears why it's inert — the tooltip alone is visual. */}
                    <span id={reasonId} className="sr-only">
                        {blockedReason}
                    </span>
                </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent className="max-w-60">
                {blockedReason}
            </TooltipContent>
        </Tooltip>
    );
}
