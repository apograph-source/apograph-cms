import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import {
    ArrowLeft,
    BookOpen,
    Lock,
    Pencil,
    Plus,
    PowerOff,
    Trash2
} from 'lucide-react';
import {
    Badge,
    Button,
    ConfirmDialog,
    Container,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    toast
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useCopilotAvailable } from '../../application/useCopilotModels';
import {
    skillWriteMessage,
    useCreateSkill,
    useDeleteSkill,
    useManageSkills,
    useSkill,
    useUpdateSkill
} from '../../application/useManageSkills';
import type { CopilotSkill } from '../../application/useSkills';
import { COPILOT_SKILLS_MANAGE, agentsPath } from '../../domain/agentsRoute';
import { SkillFormDialog, type SkillFormValues } from './SkillFormDialog';
import { useDocumentTitle } from '@orthacms/utils-admin';

const messages = defineMessages({
    title: { id: 'copilot.skills.page.title', defaultMessage: 'Skills' },
    intro: {
        id: 'copilot.skills.page.intro',
        defaultMessage:
            'Reusable instructions Ortha AI can work under. People turn a skill on for a chat from the message box; an always-on skill applies to every chat in this workspace.'
    },
    back: {
        id: 'copilot.skills.page.back',
        defaultMessage: 'Back to Ortha AI'
    },
    create: { id: 'copilot.skills.page.create', defaultMessage: 'New skill' },
    tableLabel: {
        id: 'copilot.skills.page.tableLabel',
        defaultMessage: 'Skills'
    },
    colName: { id: 'copilot.skills.page.colName', defaultMessage: 'Skill' },
    colWhen: {
        id: 'copilot.skills.page.colWhen',
        defaultMessage: 'When it applies'
    },
    colState: { id: 'copilot.skills.page.colState', defaultMessage: 'State' },
    colActions: {
        id: 'copilot.skills.page.colActions',
        defaultMessage: 'Actions'
    },
    always: { id: 'copilot.skills.page.always', defaultMessage: 'Every chat' },
    manual: {
        id: 'copilot.skills.page.manual',
        defaultMessage: 'When turned on'
    },
    on: { id: 'copilot.skills.page.on', defaultMessage: 'Available' },
    off: { id: 'copilot.skills.page.off', defaultMessage: 'Off' },
    fromCode: {
        id: 'copilot.skills.page.fromCode',
        defaultMessage: 'From code'
    },
    fromCodeHint: {
        id: 'copilot.skills.page.fromCodeHint',
        defaultMessage:
            'Defined in this deployment’s configuration. Change it with a deploy.'
    },
    edit: { id: 'copilot.skills.page.edit', defaultMessage: 'Edit {title}' },
    remove: {
        id: 'copilot.skills.page.remove',
        defaultMessage: 'Delete {title}'
    },
    emptyTitle: {
        id: 'copilot.skills.page.emptyTitle',
        defaultMessage: 'No skills yet'
    },
    emptyBody: {
        id: 'copilot.skills.page.emptyBody',
        defaultMessage:
            'A skill is a short set of instructions — a house style, a review checklist — that Ortha AI follows while it is on.'
    },
    forbiddenTitle: {
        id: 'copilot.skills.page.forbiddenTitle',
        defaultMessage: 'No access'
    },
    forbiddenBody: {
        id: 'copilot.skills.page.forbiddenBody',
        defaultMessage:
            'You don’t have permission to manage skills in this workspace.'
    },
    offTitle: {
        id: 'copilot.skills.page.offTitle',
        defaultMessage: 'Ortha AI is turned off'
    },
    offBody: {
        id: 'copilot.skills.page.offBody',
        defaultMessage:
            'This deployment doesn’t run Ortha AI, so there are no skills to manage.'
    },
    deleteTitle: {
        id: 'copilot.skills.page.deleteTitle',
        defaultMessage: 'Delete this skill?'
    },
    deleteBody: {
        id: 'copilot.skills.page.deleteBody',
        defaultMessage:
            '“{title}” will stop applying to new chats. Chats that already used it keep their record of it.'
    },
    deleteConfirm: {
        id: 'copilot.skills.page.deleteConfirm',
        defaultMessage: 'Delete'
    },
    cancel: { id: 'copilot.skills.page.cancel', defaultMessage: 'Cancel' },
    deleted: {
        id: 'copilot.skills.page.deleted',
        defaultMessage: 'Skill deleted.'
    },
    saved: { id: 'copilot.skills.page.saved', defaultMessage: 'Skill saved.' },
    deleteFailed: {
        id: 'copilot.skills.page.deleteFailed',
        defaultMessage: 'The skill could not be deleted.'
    },
    saveFailed: {
        id: 'copilot.skills.page.saveFailed',
        defaultMessage: 'The skill could not be saved.'
    }
});

/**
 * Where a workspace's skills are written — inside the Agents view at
 * `/workspaces/:id/agents/skills`.
 *
 * **Inside the Agents view, not in a global settings area**, for the same
 * reason the copilot contributes no top-level route: everything it owns is
 * workspace-scoped, and a skill is editorial guidance about *this* workspace's
 * content. The rail's footer is how you get here.
 *
 * The permission check mirrors the server's gate rather than replacing it — the
 * write routes enforce `copilot:skills:manage` regardless, and
 * `useHasPermission` is fail-closed, so someone whose permissions have not
 * loaded sees the empty state rather than a form that 403s on Save.
 */
export function SkillsPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.title));
    const workspace = useCurrentWorkspace();
    const canManage = useHasPermission(COPILOT_SKILLS_MANAGE);
    // Same probe as the Agents page, for the same reason: with the copilot off
    // every route under `/api/copilot` 404s, and a skills table that cannot
    // load reads as a broken page rather than a switched-off feature.
    const deploymentRunsCopilot = useCopilotAvailable({ enabled: canManage });

    const skills = useManageSkills(canManage ? workspace.id : null);
    const [editing, setEditing] = useState<{ id: string | null } | null>(null);
    const [removing, setRemoving] = useState<CopilotSkill | null>(null);
    const [writeError, setWriteError] = useState<string | null>(null);

    const detail = useSkill(workspace.id, editing?.id ?? null);
    const create = useCreateSkill(workspace.id);
    const update = useUpdateSkill(workspace.id);
    const remove = useDeleteSkill(workspace.id);

    if (!canManage || !deploymentRunsCopilot) {
        // Told apart rather than collapsed, exactly as on the Agents page:
        // "you may not" and "nobody may here" send the reader to different
        // people.
        const denied = !canManage;
        return (
            <Container className="py-8">
                <Empty className="border" role="alert">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            {denied ? <Lock /> : <PowerOff />}
                        </EmptyMedia>
                        <EmptyTitle>
                            {intl.formatMessage(
                                denied
                                    ? messages.forbiddenTitle
                                    : messages.offTitle
                            )}
                        </EmptyTitle>
                        <EmptyDescription>
                            {intl.formatMessage(
                                denied
                                    ? messages.forbiddenBody
                                    : messages.offBody
                            )}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </Container>
        );
    }

    const rows = skills.data ?? [];

    const save = (values: SkillFormValues) => {
        setWriteError(null);
        const onError = (error: unknown) =>
            setWriteError(
                skillWriteMessage(
                    error,
                    intl.formatMessage(messages.saveFailed)
                )
            );
        const onSuccess = () => {
            setEditing(null);
            toast.success(intl.formatMessage(messages.saved));
        };

        if (editing?.id) {
            update.mutate(
                { id: editing.id, patch: values },
                { onSuccess, onError }
            );
            return;
        }
        create.mutate(values, { onSuccess, onError });
    };

    return (
        <Container className="flex flex-col gap-6 py-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground -ml-2 mb-1 gap-1.5"
                    >
                        <Link to={agentsPath(workspace.id)}>
                            <ArrowLeft className="size-4" />
                            {intl.formatMessage(messages.back)}
                        </Link>
                    </Button>
                    <h1 className="text-xl font-semibold">
                        {intl.formatMessage(messages.title)}
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        {intl.formatMessage(messages.intro)}
                    </p>
                </div>
                <Button
                    onClick={() => {
                        setWriteError(null);
                        setEditing({ id: null });
                    }}
                    className="gap-1.5"
                >
                    <Plus className="size-4" />
                    {intl.formatMessage(messages.create)}
                </Button>
            </div>

            {skills.isLoading ? (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : rows.length === 0 ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <BookOpen />
                        </EmptyMedia>
                        <EmptyTitle>
                            {intl.formatMessage(messages.emptyTitle)}
                        </EmptyTitle>
                        <EmptyDescription>
                            {intl.formatMessage(messages.emptyBody)}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    {/* Named, like every other table in the admin: a screen
                        reader's table list otherwise reads "table" with no way
                        to tell one page's from another's (`ORT-160`). The
                        `Table` scroll wrapper also takes its own name from
                        this. */}
                    <Table aria-label={intl.formatMessage(messages.tableLabel)}>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    {intl.formatMessage(messages.colName)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.colWhen)}
                                </TableHead>
                                <TableHead>
                                    {intl.formatMessage(messages.colState)}
                                </TableHead>
                                <TableHead className="text-right">
                                    {intl.formatMessage(messages.colActions)}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((skill) => (
                                <TableRow key={`${skill.source}:${skill.name}`}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                {skill.title}
                                            </span>
                                            {skill.source === 'code' ? (
                                                <Badge
                                                    variant="outline"
                                                    title={intl.formatMessage(
                                                        messages.fromCodeHint
                                                    )}
                                                >
                                                    {intl.formatMessage(
                                                        messages.fromCode
                                                    )}
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <p className="text-muted-foreground mt-0.5 max-w-xl text-sm">
                                            {skill.description}
                                        </p>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {intl.formatMessage(
                                            skill.mode === 'always'
                                                ? messages.always
                                                : messages.manual
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant={
                                                skill.enabled
                                                    ? 'secondary'
                                                    : 'outline'
                                            }
                                        >
                                            {intl.formatMessage(
                                                skill.enabled
                                                    ? messages.on
                                                    : messages.off
                                            )}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {/* A code skill has no row to edit and
                                            no row to delete — the buttons are
                                            absent rather than disabled, because
                                            a disabled control invites a click
                                            and then explains nothing. The
                                            badge, with its tooltip, is what
                                            says why. */}
                                        {skill.editable && skill.id ? (
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={intl.formatMessage(
                                                        messages.edit,
                                                        { title: skill.title }
                                                    )}
                                                    onClick={() => {
                                                        setWriteError(null);
                                                        setEditing({
                                                            id: skill.id
                                                        });
                                                    }}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={intl.formatMessage(
                                                        messages.remove,
                                                        { title: skill.title }
                                                    )}
                                                    onClick={() =>
                                                        setRemoving(skill)
                                                    }
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <SkillFormDialog
                open={editing !== null}
                skill={editing?.id ? (detail.data ?? null) : null}
                loading={Boolean(editing?.id) && detail.isFetching}
                saving={create.isPending || update.isPending}
                error={writeError}
                onSubmit={save}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditing(null);
                        setWriteError(null);
                    }
                }}
            />

            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => {
                    if (!open) setRemoving(null);
                }}
                title={intl.formatMessage(messages.deleteTitle)}
                description={intl.formatMessage(messages.deleteBody, {
                    title: removing?.title ?? ''
                })}
                confirmLabel={intl.formatMessage(messages.deleteConfirm)}
                cancelLabel={intl.formatMessage(messages.cancel)}
                confirmVariant="destructive"
                busy={remove.isPending}
                onConfirm={() => {
                    const id = removing?.id;
                    if (!id) return;
                    remove.mutate(id, {
                        onSuccess: () => {
                            setRemoving(null);
                            toast.success(intl.formatMessage(messages.deleted));
                        },
                        onError: (error) =>
                            toast.error(
                                skillWriteMessage(
                                    error,
                                    intl.formatMessage(messages.deleteFailed)
                                )
                            )
                    });
                }}
            />
        </Container>
    );
}
