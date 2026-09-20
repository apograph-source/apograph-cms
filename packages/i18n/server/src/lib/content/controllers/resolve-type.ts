import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
    AnyContentType,
    ContentTypeRegistry
} from '@orthacms/content-server';

/**
 * Resolve a route's `:typeName` to a registered **i18n** content type: 404
 * for an unknown name (mirrors the content routes, no enumeration signal
 * beyond what `/api/content-schema` already serves), 400 for a type that
 * isn't localized (a caller bug, not a missing resource).
 */
export function resolveI18nType(
    registry: ContentTypeRegistry,
    typeName: string
): AnyContentType {
    const type = registry.get(typeName);
    if (!type) {
        throw new NotFoundException(`Unknown content type "${typeName}".`);
    }
    if (!type.i18n) {
        throw new BadRequestException(
            `Content type "${typeName}" is not localized.`
        );
    }
    return type;
}
