import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { KeyRound, Plus } from 'lucide-react';
import { PageTopBar } from '@orthacms/shell-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    Alert,
    AlertDescription,
    Button,
    Container,
    ContainerHeader,
    toast
} from '@orthacms/design-system';
import {
    useApiTokens,
    DEFAULT_PAGE_SIZE
} from '../../../application/useApiTokens';
import { useWorkspaceOptions } from '../../../application/useWorkspaceOptions';
import {
    useCreateApiToken,
    useRevokeApiToken
} from '../../../application/useApiTokensMutation';
import { ApiTokensTable } from '../../components/ApiTokensTable';
import { ApiTokensSkeleton } from '../../components/ApiTokensSkeleton';
import { ApiTokensEmpty } from '../../components/ApiTokensEmpty';
import { ApiTokensNoAccess } from '../../components/ApiTokensNoAccess';
import { CreateApiTokenDialog } from '../../components/CreateApiTokenDialog';
import { RevealSecretDialog } from '../../components/RevealSecretDialog';
import type { CreateApiTokenInput } from '../../../infrastructure/apiTokenGateway';
import { useDocumentTitle } from '@orthacms/utils-admin';

const messages = defineMessages({
    title: { id: 'apiTokens.page.title', defaultMessage: 'API tokens' },
    subtitle: {
        id: 'apiTokens.page.subtitle',
        defaultMessage:
            'Bearer tokens for reading content through the external API.'
    },
    create: { id: 'apiTokens.page.create', defaultMessage: 'New token' },
    error: {
        id: 'apiTokens.page.error',
        defaultMessage: 'Couldn’t load API tokens. Please try again.'
    },
    retry: { id: 'apiTokens.page.retry', defaultMessage: 'Retry' },
    createError: {
        id: 'apiTokens.page.createError',
        defaultMessage: 'Couldn’t create the token. Please try again.'
    },
    revokeError: {
        id: 'apiTokens.page.revokeError',
        defaultMessage: 'Couldn’t revoke the token. Please try again.'
    },
    revoked: {
        id: 'apiTokens.page.revoked',
        defaultMessage: 'Token revoked'
    },
    results: {
        id: 'apiTokens.page.results',
        defaultMessage:
            '{count, plural, one {# API token} other {# API tokens}}'
    },
    prev: { id: 'apiTokens.page.prev', defaultMessage: 'Previous' },
    next: { id: 'apiTokens.page.next', defaultMessage: 'Next' },
    pageOf: {
        id: 'apiTokens.page.pageOf',
        defaultMessage: 'Page {page} of {pageCount}'
    }
});

/** Reads a 1-based page number off `?page=`, falling back to the first page. */
function readPage(value: string | null): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * The global "API tokens" management page (rendered at `/api-tokens` in the main
 * admin sidebar's directory group — no workspace context). Lists tokens, creates
 * them (choosing the target workspace in the dialog), reveals the plaintext once
 * on creation, and revokes them. Gated on `tokens:read`; the create/revoke
 * controls additionally require `tokens:create`/`tokens:delete`.
 */
export function ApiTokensPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    const canRead = useHasPermission('tokens:read');
    const canCreate = useHasPermission('tokens:create');
    const canRevoke = useHasPermission('tokens:delete');

    // The page lives in the URL, like `/users` and `/activity`: a token list
    // page is then linkable, bookmarkable, and survives a reload or a Back.
    const [searchParams, setSearchParams] = useSearchParams();
    const page = readPage(searchParams.get('page'));
    const setPage = useCallback(
        (next: number) => {
            setSearchParams(
                (prev) => {
                    const params = new URLSearchParams(prev);
                    if (next <= 1) {
                        params.delete('page');
                    } else {
                        params.set('page', String(next));
                    }
                    return params;
                },
                { replace: true }
            );
        },
        [setSearchParams]
    );
    const [createOpen, setCreateOpen] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);

    const { data, isPending, isError, refetch } = useApiTokens(
        { page, pageSize: DEFAULT_PAGE_SIZE },
        canRead
    );
    // Workspace names for the table's Workspace column; the create dialog reuses
    // the same cached query.
    const { data: workspaces = [] } = useWorkspaceOptions(canRead);
    const workspaceNames = useMemo(
        () =>
            new Map(
                workspaces.map((workspace) => [workspace.id, workspace.name])
            ),
        [workspaces]
    );

    const createToken = useCreateApiToken();
    const revokeToken = useRevokeApiToken();

    /**
     * Drops the plaintext from the mutation cache. Closing the reveal dialog
     * clears the page's own `secret`, but the create mutation's cached *result*
     * carries the secret too, and TanStack keeps a settled mutation for its
     * `gcTime` (5 minutes by default) — so without this the credential outlives
     * the dialog that promised it was gone and follows the user around the SPA.
     * Pinned in a ref so the unmount cleanup below can never re-run on an
     * identity change.
     */
    const resetCreateRef = useRef(createToken.reset);
    resetCreateRef.current = createToken.reset;
    const forgetSecret = useCallback(() => {
        setSecret(null);
        resetCreateRef.current();
    }, []);

    // Leaving the page with the reveal dialog still open never runs the handler
    // above, so scrub the mutation on unmount as well.
    useEffect(() => () => resetCreateRef.current(), []);

    // Focus anchor for after a revoke: the kebab that opened the confirm dialog
    // is unmounted by the same re-render that lands the new status, so Radix
    // restores focus to a dead element and it falls to `<body>` (WCAG 2.4.3).
    const resultsRef = useRef<HTMLDivElement>(null);
    const wasRevoking = useRef(false);
    useEffect(() => {
        if (revokeToken.isPending) {
            wasRevoking.current = true;
            return;
        }
        if (!wasRevoking.current) {
            return;
        }
        wasRevoking.current = false;
        // A frame later, so this runs after Radix's own restoration rather than
        // racing it — and only when that restoration actually lost focus.
        requestAnimationFrame(() => {
            const active = document.activeElement;
            if (!active || active === document.body) {
                resultsRef.current?.focus();
            }
        });
    }, [revokeToken.isPending]);

    // The same anchor for the reveal dialog, which needed it more and had it
    // less. It is opened programmatically with no `DialogTrigger`, and the
    // element that was focused when it opened — the create dialog's submit
    // button — was unmounted in the very same tick by `setCreateOpen(false)`.
    // Radix therefore has neither a trigger nor a live element to restore to,
    // and focus lands on `<body>`: a keyboard user who has just been handed a
    // credential is dropped at the top of the document (WCAG 2.4.3).
    const hadSecret = useRef(false);
    useEffect(() => {
        if (secret) {
            hadSecret.current = true;
            return;
        }
        if (!hadSecret.current) {
            return;
        }
        hadSecret.current = false;
        requestAnimationFrame(() => {
            const active = document.activeElement;
            if (!active || active === document.body) {
                resultsRef.current?.focus();
            }
        });
    }, [secret]);

    const total = data?.total ?? 0;
    const effectivePageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));

    // Pull `page` back when the list shrinks under the current page — or when a
    // hand-typed `?page=` points past the end.
    useEffect(() => {
        if (data && page > pageCount) {
            setPage(pageCount);
        }
    }, [data, page, pageCount, setPage]);

    if (!canRead) {
        return (
            <>
                <PageTopBar
                    icon={KeyRound}
                    crumbs={[
                        {
                            key: 'api-tokens',
                            label: intl.formatMessage(messages.title)
                        }
                    ]}
                />
                <Container>
                    <ContainerHeader
                        title={intl.formatMessage(messages.title)}
                    />
                    <ApiTokensNoAccess />
                </Container>
            </>
        );
    }

    const tokens = data?.items ?? [];

    const submitCreate = (input: CreateApiTokenInput) => {
        createToken.mutate(input, {
            onSuccess: (created) => {
                setCreateOpen(false);
                setSecret(created.secret);
            },
            onError: () => toast.error(intl.formatMessage(messages.createError))
        });
    };

    const revoke = (id: string) => {
        revokeToken.mutate(id, {
            onSuccess: () =>
                toast.success(intl.formatMessage(messages.revoked)),
            onError: () => toast.error(intl.formatMessage(messages.revokeError))
        });
    };

    return (
        <>
            <PageTopBar
                icon={KeyRound}
                crumbs={[
                    {
                        key: 'api-tokens',
                        label: intl.formatMessage(messages.title)
                    }
                ]}
            />
            <Container>
                <ContainerHeader
                    title={intl.formatMessage(messages.title)}
                    subtitle={intl.formatMessage(messages.subtitle)}
                    actions={
                        canCreate ? (
                            <Button onClick={() => setCreateOpen(true)}>
                                <Plus />
                                {intl.formatMessage(messages.create)}
                            </Button>
                        ) : undefined
                    }
                />

                {/* Creating, revoking and paging all change the table without a
                    navigation and without a heading change, so announce the
                    result count (WCAG 4.1.3) — the same region `/users` and
                    `/activity` carry. */}
                {!isPending && !isError ? (
                    <p role="status" aria-live="polite" className="sr-only">
                        {intl.formatMessage(messages.results, { count: total })}
                    </p>
                ) : null}

                {/* The focus anchor wraps every result state, not just the
                    table, so it is still mounted whichever state a mutation
                    lands the page in. `tabIndex={-1}` keeps it focusable
                    programmatically without adding a tab stop. */}
                <div ref={resultsRef} tabIndex={-1} className="outline-none">
                    {isPending ? (
                        <ApiTokensSkeleton />
                    ) : isError ? (
                        <Alert
                            variant="destructive"
                            role="alert"
                            className="mt-4"
                        >
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                <span>
                                    {intl.formatMessage(messages.error)}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="shadow-none"
                                    onClick={() => refetch()}
                                >
                                    {intl.formatMessage(messages.retry)}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : tokens.length === 0 ? (
                        <ApiTokensEmpty
                            onCreate={
                                canCreate
                                    ? () => setCreateOpen(true)
                                    : undefined
                            }
                        />
                    ) : (
                        <>
                            <ApiTokensTable
                                tokens={tokens}
                                canRevoke={canRevoke}
                                onRevoke={revoke}
                                revokingId={
                                    revokeToken.isPending
                                        ? (revokeToken.variables ?? null)
                                        : null
                                }
                                resolveWorkspaceName={(id) =>
                                    workspaceNames.get(id) ?? id
                                }
                            />
                            {pageCount > 1 ? (
                                <div className="mt-4 flex items-center justify-end gap-3">
                                    <span className="text-sm text-muted-foreground">
                                        {intl.formatMessage(messages.pageOf, {
                                            page,
                                            pageCount
                                        })}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={page <= 1}
                                        onClick={() =>
                                            setPage(Math.max(1, page - 1))
                                        }
                                    >
                                        {intl.formatMessage(messages.prev)}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={page >= pageCount}
                                        onClick={() =>
                                            setPage(
                                                Math.min(pageCount, page + 1)
                                            )
                                        }
                                    >
                                        {intl.formatMessage(messages.next)}
                                    </Button>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </Container>

            <CreateApiTokenDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSubmit={submitCreate}
                submitting={createToken.isPending}
            />
            <RevealSecretDialog
                secret={secret}
                open={secret !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        forgetSecret();
                    }
                }}
            />
        </>
    );
}
