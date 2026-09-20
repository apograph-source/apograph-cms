/**
 * Server-side validation of entry values against a content type's field
 * specs. The single authority — the admin renders the same rules
 * client-side as a courtesy, but nothing publishes without passing here.
 *
 * The rules themselves live in the shared `@orthacms/content-domain` kernel
 * (pure, DB-free, unit-tested there); this stays as the injectable wrapper the
 * rest of the plugin and downstream plugins depend on, adapting a runtime
 * {@link AnyContentType} to the kernel's serialized-field-spec input. A content
 * type's `fields` (`AnyFieldSpec`) is structurally an `EntryFieldSpec` map, so
 * the delegation needs no adapter.
 */

import { Injectable } from '@nestjs/common';
import {
    validateEntryValues,
    type ValidationResult
} from '@orthacms/content-domain';
import type { AnyContentType } from '../../types/content-type';

// Re-exported so the plugin's historical import sites (and the public barrel)
// keep resolving these from here even though the definitions moved to the
// kernel.
export type {
    ValidationIssue,
    ValidationResult
} from '@orthacms/content-domain';

@Injectable()
export class EntryValidationService {
    /**
     * Validates a values object against a content type. Unknown keys are
     * rejected — the schema is the contract, not a suggestion. Delegates the
     * rules to the shared kernel.
     */
    validate(
        type: AnyContentType,
        values: Record<string, unknown>
    ): ValidationResult {
        return validateEntryValues(type.fields, values, {
            rejectUnknownKeys: true,
            typeName: type.name
        });
    }
}
