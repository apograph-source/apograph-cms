import { CONTENT_TYPE_KIND } from '@orthacms/content-server';
import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLID,
    GraphQLInputObjectType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLString
} from 'graphql';
import { RelationRefByEnum } from './field-types';

/**
 * Types that are the same in every schema, regardless of which content types a
 * workspace was granted. Module-level singletons: a `GraphQLType` instance is
 * shareable across schemas, and sharing them keeps the SDL identical for the
 * parts that genuinely are.
 */

/** Collection vs single, mirroring the registry's `ContentTypeKind`. */
const ContentTypeKindEnum = new GraphQLEnumType({
    name: 'ContentTypeKind',
    description: 'Multi-entry collection vs standalone page.',
    values: {
        COLLECTION: { value: CONTENT_TYPE_KIND.Collection },
        SINGLE: { value: CONTENT_TYPE_KIND.Single }
    }
});

/**
 * One timed-text track on a video or audio asset (`ORT-92`).
 *
 * Declared before {@link MediaAssetType} uses it: `fields` there is an object
 * literal rather than a thunk, so the reference is evaluated at module load.
 */
export const MediaTrackType = new GraphQLObjectType({
    name: 'MediaTrack',
    description: 'A captions, subtitles, descriptions or chapters track.',
    fields: {
        kind: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                '`captions` carries the non-speech audio a deaf viewer needs; `subtitles` is a translation for someone who can hear it.'
        },
        srclang: {
            type: new GraphQLNonNull(GraphQLString),
            description: "BCP-47 tag of the track's language."
        },
        label: {
            type: new GraphQLNonNull(GraphQLString),
            description: 'What a player shows in its track menu.'
        },
        src: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                'Where the WebVTT bytes stream from. **Requires the same bearer token as this query.**'
        },
        default: {
            type: GraphQLBoolean,
            description: 'Whether a player should enable this track by default.'
        }
    }
});

/**
 * One media asset attached to an entry.
 *
 * **The URLs are authenticated routes.** They point at the CMS's own media
 * endpoints, which take the same bearer token as the query that produced them —
 * so a server-side consumer fetches the bytes with the credential it already
 * holds. They are not public: a browser `<img src>` sends no `Authorization`
 * header, so an anonymous visitor will not load one. Proxy them, or fetch and
 * re-serve them, from whatever holds the token. Genuinely public URLs would need
 * signed links with an expiry, which do not exist yet.
 */
export const MediaAssetType = new GraphQLObjectType({
    name: 'MediaAsset',
    description:
        'A Media Library asset. Read the caveat on `url` before pointing a browser at one.',
    fields: {
        id: { type: new GraphQLNonNull(GraphQLID), description: 'Asset id.' },
        name: {
            type: new GraphQLNonNull(GraphQLString),
            description: 'Display name — the original file name.'
        },
        url: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                'Where the bytes stream from. **Requires the same bearer token as this query** — not a public URL.'
        },
        thumbUrl: {
            type: GraphQLString,
            description: 'The ~320px derivative, when one was generated.'
        },
        previewUrl: {
            type: GraphQLString,
            description: 'The ~1280px derivative, when one was generated.'
        },
        kind: {
            type: new GraphQLNonNull(GraphQLString),
            description:
                'Coarse kind — image / video / audio / document / archive.'
        },
        mimeType: {
            type: new GraphQLNonNull(GraphQLString),
            description: 'MIME type, e.g. `image/png`.'
        },
        alt: {
            type: GraphQLString,
            description:
                'The text alternative for **this usage** — the entry value’s own alt where it has one, the asset’s default otherwise, and `""` when the usage is marked decorative. `""` and `null` mean different things: `""` says "this image says nothing, render an empty alt"; `null` says "nobody has supplied one", which is a gap to report rather than an instruction to hide it.'
        },
        decorative: {
            type: GraphQLBoolean,
            description:
                'True when the author marked this usage purely presentational, so it should publish with an empty alt and be skipped by a screen reader.'
        },
        tracks: {
            type: new GraphQLNonNull(
                new GraphQLList(new GraphQLNonNull(MediaTrackType))
            ),
            description:
                'Timed-text tracks for a video or audio asset — what a consumer needs to emit `<track>`. Empty for an image, and for a video nobody has captioned.'
        }
    }
});

/**
 * A content type's identity and behaviour flags — the `/v1/content-types`
 * mirror. Deliberately carries no field list: the fields *are* the schema, and
 * introspection describes them better than a parallel list could.
 */
export const ContentTypeInfoType = new GraphQLObjectType({
    name: 'ContentTypeInfo',
    description:
        'A content type this workspace was granted. The field schema is the GraphQL schema itself — introspect the corresponding object type.',
    fields: {
        name: {
            type: new GraphQLNonNull(GraphQLString),
            description: 'Machine name / slug.'
        },
        kind: { type: new GraphQLNonNull(ContentTypeKindEnum) },
        label: { type: new GraphQLNonNull(GraphQLString) },
        description: { type: GraphQLString },
        path: {
            type: GraphQLString,
            description: 'Route a `SINGLE` page renders at.'
        },
        publishable: {
            type: new GraphQLNonNull(GraphQLBoolean),
            description:
                'Has a draft/published lifecycle. A non-publishable type has no publish state and every row is live.'
        },
        paranoid: {
            type: new GraphQLNonNull(GraphQLBoolean),
            description: 'Soft-deletes rather than removing rows.'
        },
        i18n: {
            type: new GraphQLNonNull(GraphQLBoolean),
            description:
                'Stores one row per locale, siblings sharing a `localeGroupId`.'
        }
    }
});

/** Built once and shared — the delta shape is identical for every relation. */
let relationDeltaInput: GraphQLInputObjectType | undefined;

/**
 * The per-field relation delta: assign, unassign, reorder, or set.
 *
 * A **delta**, not a replacement — ids you do not mention are left alone, so a
 * record with thousands of links never has to be sent whole. The caps
 * (`MAX_DELTA_FIELDS`, `MAX_DELTA_IDS`) are not restated in the schema; they are
 * enforced downstream by the same `class-validator` rules the REST body meets,
 * so there is one place to change them.
 */
export function relationDeltaInputFor(): GraphQLInputObjectType {
    relationDeltaInput ??= new GraphQLInputObjectType({
        name: 'RelationDeltaInput',
        description:
            'Changes to one relation field. Use `link`/`unlink`/`order` for many-to-many and inverse relations, and `set` for an owning single relation (`null` clears it).',
        fields: {
            link: {
                type: new GraphQLList(new GraphQLNonNull(GraphQLID)),
                description:
                    'Targets to assign. Re-linking an existing pair is a no-op.'
            },
            unlink: {
                type: new GraphQLList(new GraphQLNonNull(GraphQLID)),
                description: 'Targets to unassign.'
            },
            order: {
                type: new GraphQLList(new GraphQLNonNull(GraphQLID)),
                description:
                    'Desired order of the listed targets. Accepted on the owning side only.'
            },
            set: {
                type: GraphQLID,
                description:
                    'The target of an owning **single** relation; `null` clears it. Lives here rather than in `input` so it can be addressed by translation group via `by`.'
            },
            by: {
                type: RelationRefByEnum,
                description:
                    'How the ids above name their targets. `LOCALE_GROUP` resolves each to that group’s row in the source entry’s own locale, so a client that thinks in stories keeps one id per story instead of one per language.'
            }
        }
    });
    return relationDeltaInput;
}

/**
 * Names the shared schema owns. Claimed before any content type, so a content
 * type that would produce one of them fails the build loudly instead of
 * silently shadowing a shared type.
 */
export const RESERVED_TYPE_NAMES: readonly string[] = [
    'Query',
    'Mutation',
    'Subscription',
    'MediaAsset',
    'ContentTypeInfo',
    'ContentTypeKind',
    'EntryStatus',
    'EntryVisibility',
    'RelationRefBy',
    'RelationDeltaInput',
    'JSON',
    'DateTime',
    'Date'
];
