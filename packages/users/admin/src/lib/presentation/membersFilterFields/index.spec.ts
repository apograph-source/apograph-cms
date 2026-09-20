import { describe, expect, it } from 'vitest';
import { FIELD_TYPE } from '@orthacms/query-builder-admin';
import { MEMBERS_FILTER_FIELDS } from './index';

/**
 * This list is a hand-maintained mirror of the server's filter whitelist —
 * `MEMBER_FILTER_SCHEMA` in
 * `packages/users/server/src/lib/member/application/member-filter.ts`, which is
 * the source of truth. The admin package cannot import the server package, so
 * the expectation is hard-coded here on purpose: a drift means the query
 * builder offers a field the API rejects, and the user sees "couldn't load"
 * over a rule the UI itself proposed. When the server schema changes, change
 * both.
 */
describe('MEMBERS_FILTER_FIELDS', () => {
    it('offers exactly the fields the server whitelists', () => {
        // `role.key` is dotted because the server models `role` as a
        // many-to-one relation, not a column — the bare `role` is not a
        // filterable leaf and would 400.
        expect(MEMBERS_FILTER_FIELDS.map((field) => field.id)).toEqual([
            'email',
            'name',
            'status',
            'role.key',
            'createdAt'
        ]);
    });

    it('offers exactly the status values the server enumerates', () => {
        const status = MEMBERS_FILTER_FIELDS.find(
            (field) => field.id === 'status'
        );

        expect(status?.type).toBe(FIELD_TYPE.Enum);
        expect(status?.enumValues?.map((option) => option.value)).toEqual([
            'pending',
            'active',
            'disabled'
        ]);
    });

    it('gives every enum field its options', () => {
        // `enumValues` is optional on the type but required in practice for an
        // enum field: without it the value editor has nothing to offer and
        // `is_one_of` cannot be built at all.
        for (const field of MEMBERS_FILTER_FIELDS) {
            if (field.type === FIELD_TYPE.Enum) {
                expect(field.enumValues?.length).toBeGreaterThan(0);
            }
        }
    });
});
