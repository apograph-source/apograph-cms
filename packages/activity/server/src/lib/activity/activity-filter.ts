import { ScalarFieldType, type FilterSchema } from '@orthacms/utils-server';

/**
 * The filterable surface of the audit log for the query-builder engine.
 * Field keys mirror the `activity_events` column property names so the
 * translator can resolve each to its Drizzle column. Deliberately omits
 * `meta` (open jsonb) and `createdAt` (kept off the wire) — only the
 * indexed, frozen-snapshot columns are exposed.
 *
 * A user-supplied `?filter=` is validated against this schema and then
 * AND-ed with the structured query params (`subjectType`, `kind`, …) the
 * controller already accepts, so the two filter surfaces compose.
 */
export const ACTIVITY_FILTER_SCHEMA: FilterSchema = {
    fields: {
        kind: { type: ScalarFieldType.String },
        subjectType: { type: ScalarFieldType.String },
        subjectId: { type: ScalarFieldType.String },
        actorId: { type: ScalarFieldType.Uuid },
        actorType: { type: ScalarFieldType.String },
        actorEmail: { type: ScalarFieldType.String },
        workspaceId: { type: ScalarFieldType.Uuid },
        at: { type: ScalarFieldType.Date }
    }
};
