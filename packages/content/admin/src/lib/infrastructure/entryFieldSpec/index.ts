import type { EntryFieldSpec } from '@orthacms/content-domain';
import type { ContentField } from '../../domain/types/contentType';

/**
 * The one thin adapter mapping the admin's wire {@link ContentField} to the
 * kernel's serialized {@link EntryFieldSpec}. The two are all-but-identical — the
 * only gap is `ContentField.validation`, typed as the opaque wire
 * `Record<string, unknown>`, which we narrow to the kernel's rule shape here so
 * the field feeds `@orthacms/content-domain`'s validator without a cast at every
 * call site. Runtime values are unchanged; this is a pure structural bridge so the
 * kernel stays the single source of the validation rules.
 *
 * **Every field the kernel reads has to be carried across.** `multiple` is the
 * one that bites: the validator branches on it to expect a `uuid[]` on a media
 * field, so dropping it made the admin judge a gallery's list against the
 * single-asset rule and refuse to save ("must be a media asset id") over a value
 * the server would have accepted. `lang` is the same shape of mistake in the
 * other direction: leaving it out would let the admin pass a field the server
 * then refuses for a malformed language tag.
 */
export function toFieldSpec(field: ContentField): EntryFieldSpec {
    return {
        type: field.type,
        required: field.required,
        lang: field.lang,
        validation: field.validation as EntryFieldSpec['validation'],
        options: field.options,
        relation: field.relation,
        multiple: field.multiple
    };
}
