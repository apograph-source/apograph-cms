import { type AnyFieldApi } from '@tanstack/react-form';
import { InputField } from '@orthacms/design-system';

/**
 * Props for {@link AuthField}. Adapts a TanStack field to the design-system
 * {@link InputField}: the parent supplies already-localized `label`/
 * `placeholder` and wires the `field` via its `form.Field` render prop.
 */
type AuthFieldProps = {
    /** The TanStack field API from the parent's `form.Field` render prop. */
    field: AnyFieldApi;
    /** Input element id, also used for the label's `htmlFor`. */
    id: string;
    /** Localized field label. */
    label: string;
    /** Localized input placeholder. */
    placeholder: string;
    /** Input type; defaults to `text`. */
    type?: React.HTMLInputTypeAttribute;
    /** HTML `autocomplete` token (e.g. `email`, `new-password`). */
    autoComplete?: React.HTMLInputAutoCompleteAttribute;
    /** Optional label-row content rendered after the label (e.g. a link). */
    labelAction?: React.ReactNode;
    /** Optional helper text rendered under the input (e.g. a password rule). */
    description?: React.ReactNode;
};

/**
 * Form-bound text field: maps TanStack field state onto the design-system
 * {@link InputField} (label, input, validation error). Owns no copy of its own,
 * so it backs every field on the auth screens — sign-in and invite accept
 * alike.
 */
export function AuthField({
    field,
    id,
    label,
    placeholder,
    type = 'text',
    autoComplete,
    labelAction,
    description
}: AuthFieldProps) {
    const invalid =
        field.state.meta.isTouched && field.state.meta.errors.length > 0;

    return (
        <InputField
            id={id}
            name={field.name}
            type={type}
            label={label}
            placeholder={placeholder}
            autoComplete={autoComplete}
            labelAction={labelAction}
            description={description}
            invalid={invalid}
            errors={invalid ? field.state.meta.errors : undefined}
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
        />
    );
}
