import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, exists, isNull, not, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import type {
    AnyContentType,
    EntryFilterContext,
    EntryFilterExtension,
    EntryFilterProvider
} from '@orthacms/content-server';
import {
    FilterOperator,
    ScalarFieldType,
    type FieldSchema,
    type ParsedRule
} from '@orthacms/utils-server';
import { reviewRequests } from './schema/review-requests';

/** The wire name of the virtual field. */
export const REVIEW_STATE_FIELD = 'reviewState';

/** The states a record can be filtered by. */
export const REVIEW_STATE = {
    /** A review has been asked for and is still open. */
    Awaiting: 'awaiting',
    /** Nobody has asked. */
    NotRequested: 'not_requested'
} as const;

/** One of {@link REVIEW_STATE}'s values. */
export type ReviewState = (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE];

/** The operators the resolver can actually answer. */
const SUPPORTED_OPS: ReadonlySet<string> = new Set([
    FilterOperator.Eq,
    FilterOperator.In
]);

/**
 * Filtering a collection's records by **whether they are waiting on a review**.
 *
 * Contributed through content's filter-field registry, so it joins the records
 * list's own query builder rather than living on a screen of its own — which is
 * what makes saved views and alarms' "Save as rule" work over review state with
 * no code of their own. A saved view is the records URL; a rule is the records
 * filter tree; this field is in both the moment it is in the picker.
 *
 * ## Why "asked for", not "how many approvals"
 *
 * The obvious field is the counter the column shows — `1 of 2`. It is
 * deliberately not offered, and the reason is that it is not a property of a
 * row: the tally depends on the head revision, on `requireOtherPerson` against
 * the head's author, and on `countStaleApprovals`. Answering it in SQL means a
 * second implementation of {@link countApprovals} written in Drizzle, which is
 * exactly the drift #257 was amended to remove — and it would drift silently,
 * because a filter that is merely *wrong* still returns rows.
 *
 * What **is** a property of the row is whether an open request exists: one row
 * in this plugin's table, keyed by entry id, with no counting in it. That is the
 * question a reviewer actually saves a view for ("everything waiting on us"),
 * and it is answerable exactly.
 *
 * ## What it is not
 *
 * A filter narrows a list; it is not a visibility rule. Whether an entry may be
 * published is `CONTENT_PUBLISH_GUARD`'s answer and is unaffected by anything
 * here, and whether it may be *read* was never this plugin's question at all.
 */
@Injectable()
export class ReviewStateFilterProvider implements EntryFilterProvider {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /**
     * The field, on every publishable type.
     *
     * Offered whether or not the type currently has a rule: an open request is
     * real on an unprotected type too — asking for a second pair of eyes is
     * allowed there — and a picker whose entries appeared and vanished with a
     * settings toggle would break every saved view that named one.
     *
     * A **non-publishable** type is left out, because review guards the
     * `draft → published` transition and a type that is always live has no
     * transition to hold.
     */
    filterFor(type: AnyContentType): EntryFilterExtension | undefined {
        if (!type.publishable) return undefined;
        const fields: FieldSchema = {
            [REVIEW_STATE_FIELD]: {
                type: ScalarFieldType.Enum,
                enumValues: [REVIEW_STATE.Awaiting, REVIEW_STATE.NotRequested]
            }
        };
        return {
            fields,
            resolve: (rule, context) => this.resolve(rule, context)
        };
    }

    /** Translate one `reviewState` rule into SQL. */
    private async resolve(
        rule: ParsedRule,
        context: EntryFilterContext
    ): Promise<SQL> {
        if (!SUPPORTED_OPS.has(rule.op)) {
            throw new BadRequestException(
                `Operator "${rule.op}" is not supported on "${REVIEW_STATE_FIELD}".`
            );
        }
        const { type, workspaceId } = context;
        const columns = type.table as unknown as Record<
            string,
            PgColumn | undefined
        >;
        const idColumn = columns['id'];
        if (!idColumn) {
            throw new Error(
                `Content type "${type.name}" has no "id" column to match review state against.`
            );
        }

        // **Workspace-scoped.** A virtual field is a subquery over a table
        // content-server has never heard of, and one that forgets the workspace
        // turns a filter into a cross-tenant read — the first obligation the
        // filter registry states.
        const awaiting = exists(
            this.db
                .select({ one: sql`1` })
                .from(reviewRequests)
                .where(
                    and(
                        eq(reviewRequests.entryId, idColumn),
                        eq(reviewRequests.workspaceId, workspaceId),
                        isNull(reviewRequests.resolvedAt)
                    )
                )
        );

        const wanted = this.statesOf(rule);
        // Both values asked for is every row — the two states partition the
        // collection — so it is `true` rather than an `or` the planner then has
        // to see through.
        if (wanted.length === 2) return sql`true`;
        return wanted[0] === REVIEW_STATE.Awaiting ? awaiting : not(awaiting);
    }

    /**
     * The rule's value as a list of states.
     *
     * The parser has already coerced against the declared enum, so an unknown
     * state cannot arrive. An empty list is refused rather than silently
     * matching nothing: `in []` is a question nobody means to ask, and answering
     * it with an empty page looks like a working filter over missing data.
     */
    private statesOf(rule: ParsedRule): ReviewState[] {
        const raw = Array.isArray(rule.value) ? rule.value : [rule.value];
        const states = [
            ...new Set(
                raw.filter(
                    (value): value is ReviewState =>
                        value === REVIEW_STATE.Awaiting ||
                        value === REVIEW_STATE.NotRequested
                )
            )
        ];
        if (!states.length) {
            throw new BadRequestException(
                `"${REVIEW_STATE_FIELD}" needs at least one state.`
            );
        }
        return states;
    }
}
