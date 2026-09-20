/**
 * The bridge from the content registry to the transfer kernel's view of a type,
 * and the one place a type's identity fields are decided.
 *
 * "One place" is the load-bearing part. The exporter writes the identity fields
 * into every manifest, the CSV columns are laid out from them, and the importer
 * matches on them — three readers of one answer. If they could each derive it,
 * a schema change between an export and an import would silently move the
 * matching target, and records would duplicate instead of updating.
 */

import { Injectable } from '@nestjs/common';
import {
    InjectContentRegistry,
    type ContentTypeRegistry,
    type SerializedContentType
} from '@orthacms/content-server';
import {
    resolveIdentityFields,
    type IdentityResolution,
    type TransferSchemas,
    type TransferTypeSchema
} from '@orthacms/transfer-domain';
import { InjectTransferConfig } from '../transfer.tokens';
import type { TransferPluginConfig } from '../types/transfer-config';

@Injectable()
export class TransferSchemaCatalog {
    /** Memoised: the registry is fixed at boot, so this is computed once. */
    private cache?: {
        schemas: TransferSchemas;
        identity: Map<string, IdentityResolution>;
    };

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @InjectTransferConfig()
        private readonly config: TransferPluginConfig
    ) {}

    /** Every registered type, in the kernel's shape. */
    schemas(): TransferSchemas {
        return this.build().schemas;
    }

    /** One type's schema, or `undefined` if this installation has no such type. */
    schemaOf(name: string): TransferTypeSchema | undefined {
        return this.build().schemas[name];
    }

    /** A type's identity fields — the answer everything downstream matches on. */
    identityFieldsOf(name: string): readonly string[] {
        return this.build().identity.get(name)?.fields ?? [];
    }

    /** A type's identity fields **and where they came from**, for the UI. */
    identityOf(name: string): IdentityResolution {
        return (
            this.build().identity.get(name) ?? { fields: [], source: 'row-id' }
        );
    }

    /** The identity map written into an export's manifest. */
    identityMap(): Record<string, string[]> {
        const map: Record<string, string[]> = {};
        for (const [name, resolution] of this.build().identity) {
            map[name] = [...resolution.fields];
        }
        return map;
    }

    private build(): NonNullable<TransferSchemaCatalog['cache']> {
        if (this.cache) return this.cache;
        const schemas: TransferSchemas = {};
        const identity = new Map<string, IdentityResolution>();

        for (const type of this.registry.all()) {
            const serialized = this.registry.serialize(type.name);
            if (!serialized) continue;
            const schema = toTransferSchema(serialized);
            schemas[type.name] = schema;
            identity.set(
                type.name,
                resolveIdentityFields(schema, this.config.identity?.[type.name])
            );
        }

        this.cache = { schemas, identity };
        return this.cache;
    }
}

/**
 * `SerializedContentType` is already structurally a `TransferTypeSchema`, so
 * this is a narrowing rather than a translation — it exists to drop the fields
 * transfer has no business reading (admin hints, accept rules, delete
 * behaviour) rather than to reshape anything.
 */
function toTransferSchema(
    serialized: SerializedContentType
): TransferTypeSchema {
    return {
        name: serialized.name,
        publishable: serialized.publishable,
        paranoid: serialized.paranoid,
        i18n: serialized.i18n,
        fields: serialized.fields.map((field) => ({
            name: field.name,
            type: field.type,
            required: field.required,
            ...(field.localized ? { localized: true } : {}),
            ...(field.options ? { options: field.options } : {}),
            ...(field.multiple ? { multiple: true } : {}),
            ...(field.relation
                ? {
                      relation: {
                          to: field.relation.to,
                          many: field.relation.many,
                          ...(field.relation.unique !== undefined
                              ? { unique: field.relation.unique }
                              : {}),
                          ...(field.relation.inverse
                              ? { inverse: field.relation.inverse }
                              : {})
                      }
                  }
                : {})
        }))
    };
}
