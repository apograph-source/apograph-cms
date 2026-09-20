import { ContentPlugin, type AnyContentType } from '@orthacms/content-server';
import { collection, field } from '@orthacms/content-server/define';
import { ContentGraphqlPlugin } from '../content-graphql-plugin';

/**
 * The plugin factory's job beyond wiring: refuse a content model that cannot be
 * served over GraphQL, at **composition time**.
 *
 * Both checks exist because the schema is built lazily and per grant set. Left
 * to the builder, a modelling mistake boots cleanly and then 500s on the first
 * request from whichever workspace happens to be granted the offending type —
 * a production surprise instead of a failed boot, and one that never fires in a
 * staging workspace granted something else.
 */
describe('ContentGraphqlPlugin', () => {
    const pluginFor = (types: readonly AnyContentType[]) => () =>
        ContentGraphqlPlugin({ content: ContentPlugin({ types }) });

    it('builds for a model that maps cleanly', () => {
        const tag = collection('tag', { fields: { name: field.text() } });

        expect(pluginFor([tag])).not.toThrow();
    });

    it('refuses two content types that collide as GraphQL names [content:I-02]', () => {
        // A singular/plural pair: `article`'s list field and `articles`'s
        // single field are both `articles`. (The other collision the docs name
        // — `blog_post` vs `blogPost` — cannot happen: `define()` already
        // refuses a slug that is not snake_case.)
        const one = collection('article', { fields: { a: field.text() } });
        const two = collection('articles', { fields: { a: field.text() } });

        expect(pluginFor([one, two])).toThrow(
            /cannot both be served over GraphQL/
        );
    });

    it('refuses a content field that collides with the entry envelope', () => {
        // `translations` passes `define()`'s reserved-column check — it is not
        // a column at all — so this factory is the last place it can be caught
        // before a request pays for it.
        const clashing = collection('clashing', {
            i18n: true,
            fields: { translations: field.text() }
        });

        expect(pluginFor([clashing])).toThrow(
            /collides with the GraphQL entry envelope/
        );
    });
});
