import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Database } from '@orthacms/database';
import {
    ContentReadScopeRegistry,
    type ContentReadScope
} from '../../../extension/read-scope';
import type { AnyContentType } from '../../../types/content-type';
import { RelationLinkService } from './relation-link.service';

/** A stand-in target table carrying the columns the predicate looks for. */
const table = pgTable('articles', {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    status: text('status'),
    deletedAt: timestamp('deleted_at')
});

const target = {
    name: 'article',
    table,
    publishable: true,
    paranoid: true
} as unknown as AnyContentType;

/** A registry that records what it was asked about. */
function registryRecording(asked: string[]): ContentReadScopeRegistry {
    const registry = new ContentReadScopeRegistry();
    const scope: ContentReadScope = {
        scope: (context) => {
            asked.push(context.type.name);
            return undefined;
        }
    };
    registry.register(scope);
    return registry;
}

/** The service over a registry, with no database — the predicate builds no query. */
function build(registry?: ContentReadScopeRegistry) {
    return new RelationLinkService({} as Database, registry);
}

/**
 * `targetVisibleWhere` is private, and reached here deliberately: it is the one
 * definition every relation read shares — the row read, the windowed
 * `count(*) over`, and the sub-select the join reads restrict by — so what it
 * does is the whole guarantee that `items` and `total` agree. Driving it through
 * a public method would need a live database to say the same thing.
 */
function visibleWhere(
    service: RelationLinkService,
    visibility?: { publishedOnly?: boolean }
) {
    return (
        service as unknown as {
            targetVisibleWhere: (
                target: AnyContentType,
                workspaceId: string,
                visibility?: { publishedOnly?: boolean }
            ) => unknown;
        }
    ).targetVisibleWhere(target, 'w1', visibility);
}

describe('relation target visibility', () => {
    it('consults the read scopes about the TARGET type on a public read', () => {
        // Keyed to the target, not to the type the request named: a reader
        // allowed to see an article is not thereby allowed to see everything it
        // points at.
        const asked: string[] = [];
        visibleWhere(build(registryRecording(asked)), { publishedOnly: true });

        expect(asked).toEqual(['article']);
    });

    it('does not consult them on an admin read', () => {
        // `publishedOnly` is the public-read marker. An editor must see the
        // records their entry links to in order to manage them, including ones
        // no reader may fetch.
        const asked: string[] = [];
        visibleWhere(build(registryRecording(asked)), undefined);
        visibleWhere(build(registryRecording(asked)), { publishedOnly: false });

        expect(asked).toEqual([]);
    });

    it('works with no registry bound at all', () => {
        // The state of every installation with no scoping plugin.
        expect(() =>
            visibleWhere(build(undefined), { publishedOnly: true })
        ).not.toThrow();
    });
});
