import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATORS_BY_TYPE } from '../operator-support';
import { FilterOperator } from '../types';

/**
 * The operator vocabulary exists in **two** copies, and nothing kept them in
 * step.
 *
 * `FilterOperator` here is what `parseFilterTree` accepts; `WIRE_OP` in
 * `@orthacms/query-builder-admin` is what the admin's query builder writes and
 * reads back. The duplication is forced — the SPA cannot import a package that
 * drags in NestJS and Drizzle — but forced duplication is still duplication,
 * and it has already cost something: `like` went missing from the client's
 * reverse table, so a `?filter=` lifted out of a URL lost its `like` clause and
 * the next Apply re-serialised the tree **wider** than the one the link carried.
 * No error, more rows.
 *
 * ## Why the admin's file is read as text rather than imported
 *
 * `utils:I-01` — "the leaf does not import its consumers" — is the reason.
 * `utils-server` depends on no plugin and no host, and an `import` here would
 * put `@orthacms/query-builder-admin` in this package's **project graph**:
 * `nx sync` would immediately write a TypeScript project reference and the
 * filter engine would start depending on a React package. Reading the file
 * creates no such edge. This is the same trade
 * `activity/server/…/audit-event-mapping.spec.ts` makes for the audit-kind
 * catalogue, for the same reason.
 *
 * The parse is deliberately dumb: strip the comments, then take the object
 * literal's own string values. It is safe because the file is exactly that
 * shape, and its failure mode is loud — a reformat that defeats the regex
 * throws or yields an empty list, and every assertion below fails rather than
 * passing on nothing.
 *
 * One caveat worth knowing locally: nothing in Nx's graph connects the admin
 * file to this project, so a **cached** `nx test @orthacms/utils-server` will
 * not re-run after an edit to `wireOp.ts` alone. CI restores no Nx cache, so
 * the gate is real there; run `--skip-nx-cache` when checking by hand.
 */
const WIRE_OP_SOURCE =
    '../../../../../../query-builder/admin/src/lib/utils/wireOp.ts';

/** The admin's `wireOp.ts` with every comment removed. */
function adminSource(): string {
    return readFileSync(join(__dirname, WIRE_OP_SOURCE), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

/**
 * `WIRE_OP`'s wire spellings — the values, not the member names, because the
 * values are what travels.
 */
function adminWireOps(): string[] {
    const source = adminSource();
    const block = /export const WIRE_OP = \{([\s\S]*?)\} as const;/.exec(
        source
    );
    if (!block) {
        throw new Error(
            "Could not find `WIRE_OP` in the query builder's wireOp module " +
                `(${WIRE_OP_SOURCE}). If it moved, point this test at its new ` +
                'home rather than deleting the check.'
        );
    }
    const ops = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (ops.length === 0) {
        throw new Error(
            '`WIRE_OP` parsed as empty — the regex has gone stale.'
        );
    }
    return ops;
}

/** Every operator the engine accepts. */
const ENGINE_OPS: readonly string[] = Object.values(FilterOperator);

describe('the operator vocabulary is one vocabulary', () => {
    it('the query builder knows every operator the engine accepts', () => {
        const missing = ENGINE_OPS.filter((op) => !adminWireOps().includes(op));
        expect(
            `operators the engine accepts and the admin cannot name: ${missing.join(', ')}`
        ).toBe('operators the engine accepts and the admin cannot name: ');
    });

    it('the query builder names no operator the engine would reject', () => {
        const extra = adminWireOps().filter((op) => !ENGINE_OPS.includes(op));
        expect(
            `operators the admin can emit and the engine would 400: ${extra.join(', ')}`
        ).toBe('operators the admin can emit and the engine would 400: ');
    });

    /**
     * The third copy, and the one that is entirely ours.
     *
     * `OPERATORS_BY_TYPE` decides which operators a *column* may be asked. An
     * operator added to `FilterOperator` and to no type's list is in the
     * vocabulary, passes the unknown-operator check, and is then refused on
     * every field there is — `OperatorNotAllowed` on a filter that is, by the
     * only dictionary a caller can read, legal.
     */
    it('every operator in the vocabulary is legal on at least one column type', () => {
        const usable = new Set(
            Object.values(OPERATORS_BY_TYPE).flatMap((ops) => [...ops])
        );
        const orphans = ENGINE_OPS.filter((op) => !usable.has(op as never));
        expect(
            `in the vocabulary, allowed on no type: ${orphans.join(', ')}`
        ).toBe('in the vocabulary, allowed on no type: ');
    });

    it('every operator a column type allows is in the vocabulary', () => {
        const allowed = [
            ...new Set(
                Object.values(OPERATORS_BY_TYPE).flatMap((ops) => [...ops])
            )
        ];
        const unknown = allowed.filter((op) => !ENGINE_OPS.includes(op));
        expect(
            `allowed on a type, outside the vocabulary: ${unknown.join(', ')}`
        ).toBe('allowed on a type, outside the vocabulary: ');
    });
});
