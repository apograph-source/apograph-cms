import { defineMessages } from 'react-intl';
import { FIELD_TYPE, type FilterField } from '@orthacms/query-builder-admin';

/**
 * Field + enum-option labels for the members query builder, co-located per the
 * admin i18n convention. Display only — the `id`s and enum `value`s travel on
 * the wire.
 */
const messages = defineMessages({
    email: { id: 'users.filter.email', defaultMessage: 'Email' },
    name: { id: 'users.filter.name', defaultMessage: 'Name' },
    status: { id: 'users.filter.status', defaultMessage: 'Status' },
    role: { id: 'users.filter.role', defaultMessage: 'Role' },
    createdAt: { id: 'users.filter.createdAt', defaultMessage: 'Joined' },
    statusPending: {
        id: 'users.filter.status.pending',
        defaultMessage: 'Pending'
    },
    statusActive: {
        id: 'users.filter.status.active',
        defaultMessage: 'Active'
    },
    statusDisabled: {
        id: 'users.filter.status.disabled',
        defaultMessage: 'Disabled'
    },
    roleAdmin: {
        id: 'users.filter.role.admin',
        defaultMessage: 'Administrator'
    },
    roleContributor: {
        id: 'users.filter.role.contributor',
        defaultMessage: 'Contributor'
    },
    roleViewer: { id: 'users.filter.role.viewer', defaultMessage: 'Viewer' }
});

/**
 * The members filter surface the query builder offers. A static mirror of the
 * server's `MEMBER_FILTER_SCHEMA`
 * (`users/server/…/member/application/member-filter.ts`) — each `id` matches a
 * whitelisted field (the
 * `role.key` dotted path resolves to the BE's `role` relation), so a rule built
 * here always validates server-side. `status` / `role` render as dropdowns; the
 * BE still accepts any role key string, the UI just offers the system roles.
 */
export const MEMBERS_FILTER_FIELDS: readonly FilterField[] = [
    { id: 'email', label: messages.email, type: FIELD_TYPE.String },
    { id: 'name', label: messages.name, type: FIELD_TYPE.String },
    {
        id: 'status',
        label: messages.status,
        type: FIELD_TYPE.Enum,
        enumValues: [
            { value: 'pending', label: messages.statusPending },
            { value: 'active', label: messages.statusActive },
            { value: 'disabled', label: messages.statusDisabled }
        ]
    },
    {
        id: 'role.key',
        label: messages.role,
        type: FIELD_TYPE.Enum,
        enumValues: [
            { value: 'admin', label: messages.roleAdmin },
            { value: 'contributor', label: messages.roleContributor },
            { value: 'viewer', label: messages.roleViewer }
        ]
    },
    { id: 'createdAt', label: messages.createdAt, type: FIELD_TYPE.Date }
];
