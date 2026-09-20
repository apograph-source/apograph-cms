import { defineMessages } from 'react-intl';
import { FIELD_TYPE, type FilterField } from '@orthacms/query-builder-admin';
import {
    ACTIVITY_KINDS,
    ACTIVITY_SUBJECT_TYPES
} from '../../types/activityKinds';
import { ACTION_MESSAGES, SUBJECT_TYPE_MESSAGES } from '../activityMessages';

/**
 * Field labels for the activity query builder, co-located per the admin i18n
 * convention. Display only — the `id`s below are what travel on the wire.
 *
 * **They repeat the table's column headings on purpose.** A reader builds a
 * filter by naming something they can see, so "Action" and "When" are the words
 * to offer — not the column names the database happens to use. `kind` reading
 * as "Kind" and `at` as "Time" sent people looking for a filter over a column
 * whose heading said neither.
 */
const messages = defineMessages({
    action: { id: 'activity.filter.action', defaultMessage: 'Action' },
    actorEmail: {
        id: 'activity.filter.actorEmail',
        defaultMessage: 'Actor email'
    },
    actorId: { id: 'activity.filter.actorId', defaultMessage: 'Actor ID' },
    actorType: {
        id: 'activity.filter.actorType',
        defaultMessage: 'Actor type'
    },
    subjectType: {
        id: 'activity.filter.subjectType',
        defaultMessage: 'Subject type'
    },
    subjectId: {
        id: 'activity.filter.subjectId',
        defaultMessage: 'Subject ID'
    },
    workspaceId: {
        id: 'activity.filter.workspaceId',
        defaultMessage: 'Workspace ID'
    },
    when: { id: 'activity.filter.when', defaultMessage: 'When' }
});

/**
 * The activity-log filter surface the query builder offers. A static mirror of
 * the server's `ACTIVITY_FILTER_SCHEMA` — each `id` matches a whitelisted field
 * the BE accepts, so a rule built here always validates server-side. The mirror
 * is **complete**: it drifted to six of the server's eight fields, so `actorType`
 * and `workspaceId` were filterable over HTTP and unreachable from the UI, and
 * `activity-filter.spec.ts` now fails when the two lists diverge again.
 *
 * **`kind` and `subjectType` are enums, not free text.** Both columns render a
 * localized label — "Published content", "Media asset" — while the value on the
 * wire is a dotted or snake-cased token. As `FIELD_TYPE.String` the filter asked
 * the reader to type the token for a label they were looking at, which is only
 * possible if they already know the internal vocabulary. Declaring the
 * vocabulary here labels each option from the **same** descriptor map the cell
 * renders from, so the two cannot drift, and it brings `is one of` with it —
 * "published or unpublished" is the question most often asked of an audit log,
 * and free text could not express it at all.
 *
 * The other four stay open: an email, two ids and a timestamp have no closed
 * vocabulary to offer.
 */
export const ACTIVITY_FILTER_FIELDS: readonly FilterField[] = [
    {
        id: 'kind',
        label: messages.action,
        type: FIELD_TYPE.Enum,
        enumValues: ACTIVITY_KINDS.map((value) => ({
            value,
            label: ACTION_MESSAGES[value]
        }))
    },
    { id: 'actorEmail', label: messages.actorEmail, type: FIELD_TYPE.String },
    { id: 'actorId', label: messages.actorId, type: FIELD_TYPE.Uuid },
    { id: 'actorType', label: messages.actorType, type: FIELD_TYPE.String },
    {
        id: 'subjectType',
        label: messages.subjectType,
        type: FIELD_TYPE.Enum,
        enumValues: ACTIVITY_SUBJECT_TYPES.map((value) => ({
            value,
            label: SUBJECT_TYPE_MESSAGES[value]
        }))
    },
    { id: 'subjectId', label: messages.subjectId, type: FIELD_TYPE.String },
    { id: 'workspaceId', label: messages.workspaceId, type: FIELD_TYPE.Uuid },
    { id: 'at', label: messages.when, type: FIELD_TYPE.Date }
];
