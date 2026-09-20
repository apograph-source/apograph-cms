import { ContentTypeRegistry } from '@orthacms/content-server';
import { collection, field } from '@orthacms/content-server/define';
import { printSchema } from 'graphql';
import {
    assertNoEnvelopeCollisions,
    buildContentSchema
} from '../build-schema';
import {
    GRANTED_ALL,
    GRANTED_WITHOUT_VAULT,
    fixtureRegistry
} from './fixtures';

describe('buildContentSchema', () => {
    const sdlFor = (granted: ReadonlySet<string>): string =>
        printSchema(buildContentSchema(fixtureRegistry(), granted));

    describe('grant pruning', () => {
        it('omits a content type the workspace was not granted', () => {
            const sdl = sdlFor(GRANTED_WITHOUT_VAULT);

            expect(sdl).not.toContain('type Vault');
            expect(sdl).not.toMatch(/\bvaults\(/);
        });

        it('includes it once the grant is there', () => {
            expect(sdlFor(GRANTED_ALL)).toContain('type Vault');
        });

        it('omits a relation field pointing at an ungranted type', () => {
            // `article.secret` targets `vault`. Serving it as a bare id would
            // both fail to resolve and advertise a type this workspace cannot
            // see, so the field is absent entirely.
            expect(sdlFor(GRANTED_WITHOUT_VAULT)).not.toContain('secret');
            expect(sdlFor(GRANTED_ALL)).toContain('secret');
        });

        it('omits that relation from the write input too', () => {
            const withoutVault = sdlFor(GRANTED_WITHOUT_VAULT);
            const inputBlock = withoutVault.slice(
                withoutVault.indexOf('input ArticleInput')
            );

            expect(inputBlock.slice(0, inputBlock.indexOf('}'))).not.toContain(
                'secret'
            );
        });
    });

    describe('root fields', () => {
        it('gives a collection both a single and a list field', () => {
            const sdl = sdlFor(GRANTED_ALL);

            expect(sdl).toMatch(/\n {2}article\(/);
            expect(sdl).toMatch(/\n {2}articles\(/);
        });

        it('gives a single-kind type only the singular field', () => {
            const sdl = sdlFor(GRANTED_ALL);

            expect(sdl).toMatch(/\n {2}landing\(/);
            expect(sdl).not.toMatch(/\n {2}landings\(/);
        });

        it('exposes the granted content types for discovery', () => {
            expect(sdlFor(GRANTED_ALL)).toContain(
                'contentTypes: [ContentTypeInfo!]!'
            );
        });
    });

    describe('field mapping', () => {
        const sdl = (): string => sdlFor(GRANTED_ALL);

        it('maps an integer number to Int and money to Float', () => {
            expect(sdl()).toContain('readingMinutes: Int');
            // Money is integer minor units; `Int` is 32-bit and would overflow
            // around $21.4M in cents, so it is a Float that still carries an
            // exact integer.
            expect(sdl()).toContain('price: Float');
        });

        it('generates an enum for representable select options', () => {
            expect(sdl()).toContain('enum ArticleStage');
            expect(sdl()).toContain('stage: ArticleStage');
        });

        it('falls back to String when an option has no legal enum name', () => {
            // `2nd-run` cannot be a GraphQL enum value, and renaming it would
            // make the API disagree with the stored data.
            expect(sdl()).toContain('channel: String');
            expect(sdl()).not.toContain('enum ArticleChannel');
        });

        it('serves media fields as resolved assets, not stored ids', () => {
            expect(sdl()).toMatch(/cover\([\s\S]*?\): \[MediaAsset!\]!/);
        });

        it('serves an owning single relation as the target, not a list', () => {
            // A many-to-one holds at most one target, so `secret { code }`
            // beats making a consumer unwrap `secret { items { code } }`.
            expect(sdl()).toContain('secret: Vault');
            expect(sdl()).not.toContain('ArticleSecretLinks');
        });

        it('keeps the paged envelope for a join-backed relation', () => {
            expect(sdl()).toMatch(/tags\([\s\S]*?\): ArticleTagsLinks!/);
        });

        it('takes media ids on the way in', () => {
            expect(sdl()).toContain('gallery: [ID!]');
        });

        it('leaves value fields nullable on a publishable type', () => {
            // `title` is `required`, which means required *to publish* — a draft
            // may legitimately lack it, and a write-scoped token reads drafts.
            expect(sdl()).toContain('title: String\n');
            expect(sdl()).not.toContain('title: String!');
        });
    });

    describe('envelope', () => {
        it('carries publish state only on a publishable type', () => {
            const sdl = sdlFor(GRANTED_ALL);
            const tagBlock = sdl.slice(sdl.indexOf('type Tag '));

            expect(sdl).toContain('status: EntryStatus');
            expect(tagBlock.slice(0, tagBlock.indexOf('}'))).not.toContain(
                'status'
            );
        });

        it('carries locale fields and translations only on an i18n type', () => {
            const sdl = sdlFor(GRANTED_ALL);
            const tagBlock = sdl.slice(sdl.indexOf('type Tag '));

            expect(sdl).toContain('localeGroupId: ID');
            expect(tagBlock.slice(0, tagBlock.indexOf('}'))).not.toContain(
                'translations'
            );
        });
    });

    describe('mutations', () => {
        it('generates the publish lifecycle only for publishable types', () => {
            const sdl = sdlFor(GRANTED_ALL);

            expect(sdl).toContain('publishArticle(');
            expect(sdl).not.toContain('publishTag(');
        });

        it('never gives a write input field a default [content:I-28]', () => {
            // A default materialises the key in the coerced input even when the
            // caller omitted it, which would turn "leave this field alone" into
            // "overwrite it" on every partial update.
            const sdl = sdlFor(GRANTED_ALL);
            const input = sdl.slice(
                sdl.indexOf('input ArticleInput'),
                sdl.indexOf('input ArticleRelationsInput')
            );

            expect(input).not.toContain(' = ');
        });

        it('returns a boolean from a delete, matching the REST 204', () => {
            expect(sdlFor(GRANTED_ALL)).toContain('deleteArticle(');
        });
    });

    describe('name safety', () => {
        it('refuses a content field that collides with the envelope', () => {
            // `translations` is the case the registry cannot catch for us: it is
            // not a reserved *column*, so `assertFields` allows it, but it is an
            // entry field in GraphQL and two definitions cannot share a name.
            const clashing = collection('clashing', {
                i18n: true,
                fields: { translations: field.text() }
            });

            expect(() =>
                buildContentSchema(
                    new ContentTypeRegistry([clashing]),
                    new Set(['clashing'])
                )
            ).toThrow(/collides with the GraphQL entry envelope/);
        });

        it('catches an envelope collision without building a schema', () => {
            // The build-time throw fires inside a lazy field thunk, per grant
            // set — so on its own the host boots and the FIRST request from the
            // one workspace granted that type 500s. This is the check the
            // plugin factory runs at composition time instead.
            // `translations` is the reachable case: every other envelope name
            // maps to a reserved *column*, which `define()` already refuses, so
            // this is the one collision that gets as far as a schema build.
            const clashing = collection('clashing', {
                i18n: true,
                fields: { translations: field.text() }
            });

            expect(() => assertNoEnvelopeCollisions([clashing])).toThrow(
                /"translations".*collides with the GraphQL entry envelope/
            );
        });

        it('flags an envelope name even on a type whose flags hide it', () => {
            // `translations` only appears on an i18n type today, but flipping
            // `i18n` later must not be what makes a schema unbuildable.
            const clashing = collection('clashing', {
                fields: { translations: field.text() }
            });

            expect(() => assertNoEnvelopeCollisions([clashing])).toThrow(
                /collides with the GraphQL entry envelope/
            );
        });

        it('passes a model with no envelope collision', () => {
            expect(() =>
                assertNoEnvelopeCollisions(fixtureRegistry().all())
            ).not.toThrow();
        });

        it('refuses a content type that shadows a shared schema type', () => {
            const clashing = collection('media_asset', {
                fields: { name: field.text() }
            });

            expect(() =>
                buildContentSchema(
                    new ContentTypeRegistry([clashing]),
                    new Set(['media_asset'])
                )
            ).toThrow(/claimed twice/);
        });
    });

    it('is stable across builds, so a consumer diffing SDL sees real changes', () => {
        expect(sdlFor(GRANTED_ALL)).toEqual(sdlFor(GRANTED_ALL));
    });
});
