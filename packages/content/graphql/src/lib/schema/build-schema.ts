import {
    CONTENT_FIELD_TYPE,
    CONTENT_TYPE_KIND,
    DEFAULT_EXPANSION_LIMIT,
    MAX_PAGE_SIZE,
    type AnyContentType,
    type ContentTypeRegistry,
    type PublicEntry
} from '@orthacms/content-server';
import {
    GraphQLBoolean,
    GraphQLID,
    GraphQLInputObjectType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLString,
    type GraphQLFieldConfig,
    type GraphQLFieldConfigArgumentMap,
    type GraphQLFieldConfigMap,
    type GraphQLInputFieldConfigMap
} from 'graphql';
import type { GraphqlContext } from '../resolvers/context';
import {
    listResolver,
    mediaResolver,
    pageResolver,
    relationResolver,
    singleRelationResolver,
    singleResolver,
    translationsResolver,
    valueResolver
} from '../resolvers/entry-resolvers';
import {
    createResolver,
    deleteResolver,
    publishResolver,
    updateResolver
} from '../resolvers/mutation-resolvers';
import {
    EntryStatusEnum,
    EntryVisibilityEnum,
    TypeNameRegistry,
    inputTypeFor,
    valueTypeFor
} from './field-types';
import { namesFor } from './naming';
import { GraphQLDateTime, GraphQLJSON } from './scalars';
import {
    ContentTypeInfoType,
    MediaAssetType,
    RESERVED_TYPE_NAMES,
    relationDeltaInputFor
} from './shared-types';

/**
 * Builds the GraphQL schema **one workspace's content grants can see**.
 *
 * The schema is derived per grant set rather than once at boot, and that is the
 * load-bearing decision of this whole package. The REST API prunes
 * `/v1/content-types` and 404s an ungranted `:typeName` precisely so a token
 * cannot enumerate the content model beyond what its workspace exposes. A single
 * global schema would hand every token the entire model through introspection —
 * a strictly worse leak than the one REST goes out of its way to avoid. So an
 * ungranted type does not appear here at all, and naming it is a validation
 * error before a resolver runs: the same answer as REST's 404, arrived at
 * earlier and without a round trip.
 *
 * Everything below is a pure function of `(registry, granted)` — no Nest, no
 * database, no request — which is what makes the result cacheable and this file
 * unit-testable on its own.
 */
export function buildContentSchema(
    registry: ContentTypeRegistry,
    granted: ReadonlySet<string>
): GraphQLSchema {
    const names = new TypeNameRegistry();
    for (const reserved of RESERVED_TYPE_NAMES) {
        names.claim(reserved, 'the shared schema');
    }

    const types = registry
        .all()
        .filter((type) => granted.has(type.name))
        // Registration order is the host's declaration order, which is
        // arbitrary; sorting makes the SDL stable so a consumer diffing it sees
        // real changes rather than a reshuffle.
        .sort((a, b) => a.name.localeCompare(b.name));

    const objects = new Map<string, EntryObjectType>();
    const lists = new Map<string, GraphQLObjectType>();

    // Two passes: every object type is registered before any field thunk runs,
    // so relations between types resolve regardless of declaration order (and a
    // self-referential type works at all).
    for (const type of types) {
        const typeNames = namesFor(type.name);
        names.claim(typeNames.object, `content type "${type.name}"`);
        names.claim(typeNames.list, `content type "${type.name}"`);
        objects.set(
            type.name,
            new GraphQLObjectType<PublicEntry, GraphqlContext>({
                name: typeNames.object,
                description: describeType(type),
                fields: () => entryFields(type, objects, granted, names)
            })
        );
    }
    for (const type of types) {
        const typeNames = namesFor(type.name);
        const object = must(objects, type.name, 'object type');
        lists.set(
            type.name,
            new GraphQLObjectType({
                name: typeNames.list,
                description: `One page of \`${type.name}\` entries.`,
                fields: {
                    items: {
                        type: new GraphQLNonNull(
                            new GraphQLList(new GraphQLNonNull(object))
                        ),
                        description: 'The entries on this page.'
                    },
                    total: {
                        type: new GraphQLNonNull(GraphQLInt),
                        description:
                            'Total matching entries, ignoring pagination.'
                    }
                }
            })
        );
    }

    const query = new GraphQLObjectType<unknown, GraphqlContext>({
        name: 'Query',
        fields: () => queryFields(types, objects, lists, granted)
    });
    const mutationFieldMap = mutationFields(types, objects, granted, names);
    const mutation =
        Object.keys(mutationFieldMap).length > 0
            ? new GraphQLObjectType<unknown, GraphqlContext>({
                  name: 'Mutation',
                  fields: mutationFieldMap
              })
            : undefined;

    return new GraphQLSchema({
        query,
        ...(mutation ? { mutation } : {}),
        description:
            'The Ortha CMS public content API. Authenticate with `Authorization: Bearer <token>`; pick a workspace with `X-Workspace-Id` when the token covers more than one. This schema describes exactly the content types the resolved workspace was granted — another workspace’s token sees a different one.'
    });
}

/** An entry object type — its source value is always a `PublicEntry`. */
type EntryObjectType = GraphQLObjectType<PublicEntry, GraphqlContext>;

/**
 * The built type for a content type name.
 *
 * Every granted type is registered in the first pass before any field thunk
 * runs, so a miss here is a bug in this file rather than bad input — and it
 * would otherwise surface as `undefined` deep inside graphql-js's type
 * validation, naming neither the content type nor the field that reached for
 * it.
 */
function must<T>(built: Map<string, T>, name: string, kind: string): T {
    const type = built.get(name);
    if (!type) {
        throw new Error(
            `No GraphQL ${kind} was built for content type "${name}" — it should have been registered in the first pass.`
        );
    }
    return type;
}

/**
 * The SDL description of one content type, from what the author declared plus
 * the behaviour its flags imply — so the schema explains the draft lifecycle and
 * the locale model where a consumer will actually read it.
 */
function describeType(type: AnyContentType): string {
    const notes: string[] = [];
    if (type.description) {
        notes.push(type.description);
    }
    notes.push(
        type.kind === CONTENT_TYPE_KIND.Single
            ? 'A standalone page — one record.'
            : 'A collection of entries.'
    );
    if (type.publishable) {
        notes.push(
            'Publishable: reads return published entries unless a write-scoped token asks for drafts.'
        );
    }
    if (type.i18n) {
        notes.push(
            'Localized: one row per locale, siblings sharing a `localeGroupId`.'
        );
    }
    return notes.join(' ');
}

/**
 * Fails when any content type declares a field the GraphQL entry envelope
 * already owns.
 *
 * Called from the plugin factory at **composition time**, for the same reason
 * `assertNoNameCollisions` is: a field named `status` is a modelling bug, and
 * discovering it when the first request arrives from the one workspace granted
 * that type turns it into a production surprise — a 500 on a live endpoint —
 * instead of a failed boot. The check inside {@link entryFields} stays as the
 * backstop for a registry assembled some other way.
 *
 * Checked against the whole envelope regardless of the type's flags: `status`
 * only appears on a publishable type, but flipping `publishable` later must not
 * be what turns a schema unbuildable.
 */
export function assertNoEnvelopeCollisions(
    types: readonly AnyContentType[]
): void {
    for (const type of types) {
        for (const fieldName of Object.keys(type.fields)) {
            if (ENVELOPE_FIELDS.includes(fieldName)) {
                throw new Error(envelopeCollision(type.name, fieldName));
            }
        }
    }
}

/** The one message both the boot check and the build-time backstop raise. */
function envelopeCollision(typeName: string, fieldName: string): string {
    return `Content type "${typeName}" defines a field named "${fieldName}", which collides with the GraphQL entry envelope. Rename it.`;
}

/** Envelope field names an entry object always carries. */
const ENVELOPE_FIELDS = [
    'id',
    'createdAt',
    'updatedAt',
    'status',
    'publishedAt',
    'locale',
    'localeGroupId',
    'translations'
];

/** The fields of one content type's entry object. */
function entryFields(
    type: AnyContentType,
    objects: Map<string, EntryObjectType>,
    granted: ReadonlySet<string>,
    names: TypeNameRegistry
): GraphQLFieldConfigMap<PublicEntry, GraphqlContext> {
    const fields: GraphQLFieldConfigMap<PublicEntry, GraphqlContext> = {
        id: {
            type: new GraphQLNonNull(GraphQLID),
            description: 'Entry id — stable for one row, per locale.'
        },
        createdAt: {
            type: new GraphQLNonNull(GraphQLDateTime),
            description: 'When the entry was created.'
        },
        updatedAt: {
            type: new GraphQLNonNull(GraphQLDateTime),
            description: 'When the entry was last written.'
        }
    };
    if (type.publishable) {
        fields['status'] = {
            type: EntryStatusEnum,
            description:
                'Publish state. `DRAFT` with a non-null `publishedAt` is live content carrying unpublished edits.'
        };
        fields['publishedAt'] = {
            type: GraphQLDateTime,
            description:
                'When the entry last went live. Never null on an entry a read-only token can see — an entry with no published version is not served at all.'
        };
    }
    if (type.i18n) {
        fields['locale'] = {
            type: GraphQLString,
            description: 'Locale slug of this row.'
        };
        fields['localeGroupId'] = {
            type: GraphQLID,
            description:
                'The translation group this row belongs to — the stable identity of the record across languages, and what `localeGroupId:` addresses.'
        };
        fields['translations'] = {
            type: new GraphQLNonNull(
                new GraphQLList(
                    new GraphQLNonNull(must(objects, type.name, 'object type'))
                )
            ),
            description:
                'The entry’s **other** published locale rows, ordered by locale slug. The entry itself is not repeated, so `[entry, ...entry.translations]` is the full group.',
            resolve: translationsResolver(type)
        };
    }

    for (const [fieldName, spec] of Object.entries(type.fields)) {
        if (ENVELOPE_FIELDS.includes(fieldName)) {
            throw new Error(envelopeCollision(type.name, fieldName));
        }
        if (spec.type === CONTENT_FIELD_TYPE.Relation) {
            const target = spec.relation?.to();
            // An ungranted target is omitted rather than served as an id: this
            // workspace cannot read that type, so a field pointing into it would
            // both fail and advertise the type's existence in the SDL.
            if (!target || !granted.has(target.name)) {
                continue;
            }
            fields[fieldName] = relationField(type, fieldName, target, objects);
            continue;
        }
        if (spec.type === CONTENT_FIELD_TYPE.Media) {
            fields[fieldName] = {
                type: new GraphQLNonNull(
                    new GraphQLList(new GraphQLNonNull(MediaAssetType))
                ),
                description: `Assets attached to the \`${fieldName}\` media field, in their stored order.`,
                args: {
                    limit: {
                        type: GraphQLInt,
                        description: `Most assets to return (default ${DEFAULT_EXPANSION_LIMIT}).`
                    }
                },
                resolve: mediaResolver(type, fieldName)
            };
            continue;
        }
        const valueType = valueTypeFor(spec, {
            objectName: namesFor(type.name).object,
            fieldName,
            names
        });
        if (!valueType) {
            continue;
        }
        fields[fieldName] = {
            type: valueType,
            ...(spec.admin?.description
                ? { description: String(spec.admin.description) }
                : {}),
            resolve: valueResolver(fieldName)
        };
    }
    return fields;
}

/** One relation field: a paged list of the target type's entries. */
function relationField(
    type: AnyContentType,
    fieldName: string,
    target: AnyContentType,
    objects: Map<string, EntryObjectType>
): GraphQLFieldConfig<PublicEntry, GraphqlContext> {
    const targetObject = must(objects, target.name, 'object type');
    const spec = type.fields[fieldName];
    // An owning many-to-one holds at most one target, so it is served as the
    // target itself. Everything join-backed — an owning many-to-many, and either
    // inverse — is genuinely a list and keeps the paged envelope.
    if (spec?.relation && !spec.relation.many && !spec.relation.inverse) {
        return {
            type: targetObject,
            description: `The linked \`${target.name}\`, or null when unset (or when its target is no longer published).`,
            resolve: singleRelationResolver(type, fieldName)
        };
    }
    return {
        type: new GraphQLNonNull(
            new GraphQLObjectType({
                // An inline envelope rather than the target's shared `XList`:
                // a relation reports the count of links the caller can actually
                // reach, which is not the same number as a list query's total.
                name: `${namesFor(type.name).object}${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}Links`,
                description: `Links of \`${type.name}.${fieldName}\` → \`${target.name}\`.`,
                fields: {
                    items: {
                        type: new GraphQLNonNull(
                            new GraphQLList(new GraphQLNonNull(targetObject))
                        ),
                        description:
                            'One page of the linked entries. Only published, non-deleted targets appear.'
                    },
                    total: {
                        type: new GraphQLNonNull(GraphQLInt),
                        description:
                            'Links actually reachable, ignoring the page. A target the caller may not see is neither shown nor counted.'
                    }
                }
            })
        ),
        args: {
            page: { type: GraphQLInt, description: '1-based page number.' },
            pageSize: {
                type: GraphQLInt,
                description: `Links per page (1…${MAX_PAGE_SIZE}, default ${DEFAULT_EXPANSION_LIMIT}). Paging past page 1 inside a list costs one query per row — prefer a larger page.`
            }
        },
        resolve: relationResolver(type, fieldName)
    };
}

/** The root query fields — two per collection, one per single, plus discovery. */
function queryFields(
    types: readonly AnyContentType[],
    objects: Map<string, EntryObjectType>,
    lists: Map<string, GraphQLObjectType>,
    granted: ReadonlySet<string>
): GraphQLFieldConfigMap<unknown, GraphqlContext> {
    const fields: GraphQLFieldConfigMap<unknown, GraphqlContext> = {
        contentTypes: {
            type: new GraphQLNonNull(
                new GraphQLList(new GraphQLNonNull(ContentTypeInfoType))
            ),
            description:
                'Every content type this workspace was granted. Overlaps introspection deliberately: the `publishable` / `paranoid` / `i18n` flags describe behaviour that SDL cannot express, so a client switching from REST does not lose them.',
            resolve: (_source, _args, context) =>
                context.registry
                    .summaries()
                    .filter((summary) => granted.has(summary.name))
        }
    };

    for (const type of types) {
        const typeNames = namesFor(type.name);
        if (type.kind === CONTENT_TYPE_KIND.Single) {
            // A `single` is one record, so it gets the singular field only —
            // an improvement on REST, where a single is served by the list
            // route and every caller writes `items[0]`.
            fields[typeNames.single] = {
                type: must(objects, type.name, 'object type'),
                description: `The \`${type.name}\` page${type.i18n ? ' in the requested locale' : ''}. Null when it has not been published yet.`,
                args: readArgs({ locator: false, i18n: type.i18n }),
                resolve: pageResolver(type.name)
            };
            continue;
        }
        fields[typeNames.single] = {
            type: must(objects, type.name, 'object type'),
            description: `One published \`${type.name}\` entry, by \`id\` or by \`localeGroupId\` + \`locale\`. A draft, a soft-deleted entry, one in another workspace, and an unknown id are all the same null.`,
            args: readArgs({ locator: true, i18n: type.i18n }),
            resolve: singleResolver(type.name)
        };
        fields[typeNames.plural] = {
            type: new GraphQLNonNull(must(lists, type.name, 'list type')),
            description: `One page of published \`${type.name}\` entries, newest-updated first by default.`,
            args: listArgs(type.i18n),
            resolve: listResolver(type.name)
        };
    }
    return fields;
}

/** The root mutation fields — five per content type. */
function mutationFields(
    types: readonly AnyContentType[],
    objects: Map<string, EntryObjectType>,
    granted: ReadonlySet<string>,
    names: TypeNameRegistry
): GraphQLFieldConfigMap<unknown, GraphqlContext> {
    const fields: GraphQLFieldConfigMap<unknown, GraphqlContext> = {};
    for (const type of types) {
        const typeNames = namesFor(type.name);
        const object = new GraphQLNonNull(
            must(objects, type.name, 'object type')
        );
        const input = writeInputFor(type, granted, names);
        const relations = relationsInputFor(type, granted, names);
        const writeArgs: GraphQLFieldConfigArgumentMap = {
            ...(input ? { input: { type: input } } : {}),
            ...(relations ? { relations: { type: relations } } : {})
        };
        const locator = locatorArgs(type.i18n);

        fields[typeNames.mutations.create] = {
            type: object,
            description: `Create a \`${type.name}\` entry.${type.publishable ? ' It lands as a **draft** — publishing is a separate call, so a create always has a reviewable state.' : ''} Values are validated ${type.publishable ? 'at publish, not here: a draft may legitimately be incomplete' : 'immediately, since a non-publishable type is always live'}.`,
            args: {
                ...writeArgs,
                ...(type.i18n
                    ? {
                          locale: {
                              type: GraphQLString,
                              description:
                                  'Locale the new row is written in. Absent means the configured default.'
                          },
                          localeGroupId: {
                              type: GraphQLID,
                              description:
                                  'An existing translation group to join, making this row a sibling translation. Absent starts a fresh group.'
                          }
                      }
                    : {})
            },
            resolve: createResolver(type.name)
        };
        fields[typeNames.mutations.update] = {
            type: object,
            description:
                'A **partial** update: the values you send are merged over the stored ones, so omitting a field leaves it alone and sending `null` clears it. Relation deltas apply in the same transaction.' +
                (type.publishable
                    ? ' A published entry moves back to draft while its published version stays live — publish again to ship the change.'
                    : ''),
            args: { ...locator, ...writeArgs },
            resolve: updateResolver(type.name)
        };
        if (type.publishable) {
            fields[typeNames.mutations.publish] = {
                type: object,
                description:
                    'Re-validates the stored row and takes it live. A draft that no longer passes validation fails here, naming the offending fields — `required` means required *to publish*.',
                args: locator,
                resolve: publishResolver(type.name, true)
            };
            fields[typeNames.mutations.unpublish] = {
                type: object,
                description:
                    'Reverts the entry to a draft. It leaves the published reads immediately; a write-scoped token can still see it with `status: DRAFT`.',
                args: locator,
                resolve: publishResolver(type.name, false)
            };
        }
        fields[typeNames.mutations.remove] = {
            type: new GraphQLNonNull(GraphQLBoolean),
            description: `${type.paranoid ? 'Soft-deletes' : 'Hard-deletes'} the entry.${type.i18n ? ' Removes **one** translation — the group’s other locales stay live.' : ''} Returns \`true\`; the REST counterpart answers 204, so there is no payload to agree on.`,
            args: locator,
            resolve: deleteResolver(type.name)
        };
    }
    return fields;
}

/** The write input for one type, or `undefined` when it has no settable field. */
function writeInputFor(
    type: AnyContentType,
    granted: ReadonlySet<string>,
    names: TypeNameRegistry
): GraphQLInputObjectType | undefined {
    const fields: GraphQLInputFieldConfigMap = {};
    for (const [fieldName, spec] of Object.entries(type.fields)) {
        if (spec.type === CONTENT_FIELD_TYPE.Relation) {
            const target = spec.relation?.to();
            if (!target || !granted.has(target.name)) {
                continue;
            }
        }
        const inputType = inputTypeFor(fieldName, spec, {
            objectName: namesFor(type.name).object,
            names
        });
        if (!inputType) {
            continue;
        }
        fields[fieldName] = {
            type: inputType,
            description:
                spec.type === CONTENT_FIELD_TYPE.Media
                    ? 'Media Library asset id(s).'
                    : spec.type === CONTENT_FIELD_TYPE.Relation
                      ? 'Target entry id for this single relation.'
                      : undefined
            // NO `defaultValue`, ever. An input field with a default is present
            // in the coerced object even when the caller omitted it, which would
            // turn "leave this field alone" into "overwrite it" on every partial
            // update. The absent-vs-null distinction IS the update contract.
        };
    }
    if (Object.keys(fields).length === 0) {
        return undefined;
    }
    const name = namesFor(type.name).input;
    names.claim(name, `content type "${type.name}"`);
    return new GraphQLInputObjectType({
        name,
        description: `Field values for a \`${type.name}\` write. Every field is optional: on a create an omitted field is simply unset, and on an update it is left untouched (send \`null\` to clear it).`,
        fields
    });
}

/** The relation-delta input for one type, or `undefined` when it has no relations. */
function relationsInputFor(
    type: AnyContentType,
    granted: ReadonlySet<string>,
    names: TypeNameRegistry
): GraphQLInputObjectType | undefined {
    const fields: GraphQLInputFieldConfigMap = {};
    for (const [fieldName, spec] of Object.entries(type.fields)) {
        if (spec.type !== CONTENT_FIELD_TYPE.Relation) {
            continue;
        }
        const target = spec.relation?.to();
        if (!target || !granted.has(target.name)) {
            continue;
        }
        fields[fieldName] = {
            type: relationDeltaInputFor(),
            description: `Changes to the \`${fieldName}\` links (→ \`${target.name}\`).`
        };
    }
    if (Object.keys(fields).length === 0) {
        return undefined;
    }
    const name = namesFor(type.name).relationsInput;
    names.claim(name, `content type "${type.name}"`);
    return new GraphQLInputObjectType({
        name,
        description: `Relation changes for a \`${type.name}\` write — a **delta**, not a replacement: links you do not mention are left alone, so a record with thousands of links never has to be sent whole.`,
        fields
    });
}

/** Arguments every single-entry read takes. */
function readArgs(options: {
    locator: boolean;
    i18n: boolean;
}): GraphQLFieldConfigArgumentMap {
    return {
        ...(options.locator ? locatorArgs(options.i18n) : {}),
        ...(options.i18n && !options.locator
            ? {
                  locale: {
                      type: GraphQLString,
                      description:
                          'Locale to read in. Absent means the configured default.'
                  }
              }
            : {}),
        status: visibilityArg()
    };
}

/** Arguments every list read takes. */
function listArgs(i18n: boolean): GraphQLFieldConfigArgumentMap {
    return {
        page: { type: GraphQLInt, description: '1-based page number.' },
        pageSize: {
            type: GraphQLInt,
            description: `Rows per page, capped at ${MAX_PAGE_SIZE}.`
        },
        sort: {
            type: GraphQLString,
            description:
                'A whitelisted column id (ascending) or `-`-prefixed (descending), e.g. `-publishedAt`. Unknown keys fall back to `-updatedAt`.'
        },
        search: {
            type: GraphQLString,
            description:
                'Free-text, case-insensitive search across the type’s text-like columns.'
        },
        filter: {
            type: GraphQLJSON,
            description:
                'Structured filter tree — the same shape the REST `?filter=` parameter and the admin query builder use. Filterable: the type’s own scalar fields plus `id`, `createdAt`, `updatedAt`, `publishedAt`, and, on localized types, `locale` and `localeGroupId`.'
        },
        ...(i18n
            ? {
                  locale: {
                      type: GraphQLString,
                      description:
                          'Locale to read in. Absent means the configured default.'
                  }
              }
            : {}),
        status: visibilityArg()
    };
}

/** `id` / `localeGroupId` / `locale` — how a single row is addressed. */
function locatorArgs(i18n: boolean): GraphQLFieldConfigArgumentMap {
    return {
        id: {
            type: GraphQLID,
            description:
                'The entry id. Mutually exclusive with `localeGroupId`.'
        },
        ...(i18n
            ? {
                  localeGroupId: {
                      type: GraphQLID,
                      description:
                          'A translation group id — the stable identity of the record across languages. Combine with `locale` to pick the row.'
                  },
                  locale: {
                      type: GraphQLString,
                      description:
                          'Which locale of the group to address. Ignored when `id` is given, since an id already names one row.'
                  }
              }
            : {})
    };
}

/** The shared `status:` argument. */
function visibilityArg() {
    return {
        type: EntryVisibilityEnum,
        description:
            'Publish states to return. `PUBLISHED` (the default) is all a read-only token may ask for.'
    };
}
