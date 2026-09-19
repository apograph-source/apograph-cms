/**
 * The audit-event kinds the Activity Log renders. The admin can't import the
 * server plugins (separate apps / module boundaries), so it restates the kind
 * strings here — exactly as it restates wire types — as the source for the
 * `ActivityKind` type and the action-label map. Each string mirrors a kind an
 * emitting plugin records (identity owns auth/workspace/token, users owns
 * member lifecycle, content owns the entry publish lifecycle, media owns the
 * asset/folder lifecycle).
 *
 * **This list must stay in step with the server's audit catalogue**
 * (`FACET_MAPPERS` in `@apograph/activity-server`'s `audit-event-mapping.ts`,
 * whose *output* `kind`s these are — not its input event kinds). A kind the
 * server writes and this list omits is not a type error anywhere: the mapper
 * casts `dto.kind as ActivityKind`, `formatActivityAction` finds no descriptor,
 * and the Action column prints the raw dotted wire token untranslated. That is
 * exactly what happened to the six `workspace.*` kinds, `user.activated` and
 * all seven `media.*` kinds before ORT-48. `apps/admin-e2e`'s
 * `activity-kinds.spec.ts` pins the whole catalogue so a new server kind is
 * caught by a failing test rather than by a reader seeing `media.asset.uploaded`
 * in the UI.
 *
 * **That e2e pin is not, on its own, enough** — its fixture is built from *this*
 * list, so it proves the list is self-consistent and can never notice the
 * server having moved ahead of it. Three `user.sso_*` kinds shipped exactly
 * that way. The check that closes it is `audit-event-mapping.spec.ts`'s "the
 * admin catalogue" block, which reads this file directly and compares it with
 * the server's `AUDIT_KINDS` in both directions.
 *
 * **This module must keep importing nothing.** That is what lets a Node test
 * read it without pulling React or the admin runtime in; if it ever needs an
 * import, both lists belong in a shared package instead.
 */
export const ACTIVITY_KINDS = [
    'user.invited',
    'user.invite_resent',
    'user.invite_revoked',
    'user.password_reset_issued',
    'user.invite_link_revealed',
    'user.activated',
    'user.profile_updated',
    'user.role_changed',
    'user.suspended',
    'user.reactivated',
    'user.password_changed',
    'user.signed_in',
    'user.signed_out',
    'user.sign_in_failed',
    'user.session_revoked',
    'user.sso_linked',
    'user.sso_provisioned',
    'user.sso_role_mapped',
    'workspace.created',
    'workspace.updated',
    'workspace.archived',
    'workspace.unarchived',
    'workspace.deleted',
    'workspace.member_added',
    'workspace.member_removed',
    'workspace.content_granted',
    'workspace.content_revoked',
    'entry.created',
    'entry.updated',
    'entry.published',
    'entry.unpublished',
    'entry.deleted',
    'entry.restored',
    'entry.purged',
    'token.created',
    'token.revoked',
    'token.used',
    'media.asset.uploaded',
    'media.asset.updated',
    'media.asset.moved',
    'media.asset.deleted',
    'media.folder.created',
    'media.folder.renamed',
    'media.folder.deleted',
    'transfer.content.exported',
    'transfer.content.imported',
    'segment.created',
    'segment.updated',
    'segment.deleted',
    'segment.entry_access_changed',
    'alarm.rule.created',
    'alarm.rule.updated',
    'alarm.rule.deleted',
    'alarm.rule.rescanned',
    'saved_view.created',
    'saved_view.updated',
    'saved_view.deleted',
    'copilot.skill.created',
    'copilot.skill.updated',
    'copilot.skill.deleted',
    'copilot.tool_permission.decided',
    'review.requested',
    'review.approved',
    'review.changes_requested',
    'protection.rule_changed',
    'entry.publish_bypassed',
    'outbox.event_retried'
] as const;

/** A kind the Activity Log knows how to render. */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * The subject types the server stamps on an audit row — the `subjectType`
 * column's whole range. Restated here for the same reason as the kinds, and
 * used to give the Subject cell a localized label: the raw values are
 * snake_cased machine tokens (`media_asset`, `content_entry`), which a bare CSS
 * `capitalize` renders as "Media_asset" rather than "Media asset".
 */
export const ACTIVITY_SUBJECT_TYPES = [
    'user',
    'workspace',
    'content_entry',
    'content_type',
    'api_token',
    'media_asset',
    'media_folder',
    'login_attempt',
    'segment',
    'alarm_rule',
    'saved_view',
    'copilot_skill',
    'copilot_run',
    'protection_rule',
    'outbox_event'
] as const;

/** A subject type the Activity Log knows how to name. */
export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number];
