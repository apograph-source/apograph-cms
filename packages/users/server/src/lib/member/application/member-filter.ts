import { ScalarFieldType, type FilterSchema } from '@orthacms/utils-server';
import { roles, users } from '@orthacms/identity-server';

/**
 * The filterable surface of the member list for the query-builder engine.
 * Scalar field keys mirror the `users` column property names; `role` is a
 * many-to-one relation onto `roles` (a user holds exactly one global role),
 * so `role.key` / `role.name` resolve to an `EXISTS (… roles …)` subquery
 * that composes into the WHERE tree without joining `roles` into the count
 * and page queries.
 *
 * `role.key` is typed as a free-form string rather than an enum so custom
 * (non-system) roles remain filterable; the admin UI constrains the choices
 * it offers. A user-supplied `?filter=` is validated against this schema and
 * AND-ed with the existing `search` / `status` params.
 */
export const MEMBER_FILTER_SCHEMA: FilterSchema = {
    fields: {
        email: { type: ScalarFieldType.String },
        name: { type: ScalarFieldType.String },
        status: {
            type: ScalarFieldType.Enum,
            enumValues: ['pending', 'active', 'disabled']
        },
        createdAt: { type: ScalarFieldType.Date }
    },
    relations: {
        role: {
            kind: 'many-to-one',
            table: roles,
            fk: users.roleId,
            fields: {
                key: { type: ScalarFieldType.String },
                name: { type: ScalarFieldType.String }
            }
        }
    }
};
