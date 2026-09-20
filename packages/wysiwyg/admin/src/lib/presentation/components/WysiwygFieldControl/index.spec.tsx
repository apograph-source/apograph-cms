import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { vi } from 'vitest';
import type { EntryFieldControlContext } from '@orthacms/content-admin';
import { WysiwygFieldControl } from '.';

/** A `richtext` field the schema marks required — the case that discriminates. */
const FIELD: EntryFieldControlContext['field'] = {
    name: 'body',
    type: 'richtext',
    required: true,
    validation: {},
    admin: {}
};

function renderControl(overrides: Partial<EntryFieldControlContext> = {}) {
    const context: EntryFieldControlContext = {
        field: FIELD,
        id: 'entry-field-body',
        label: 'Body',
        value: null,
        error: 'Body is required',
        describedBy: 'entry-field-body-error',
        onChange: vi.fn(),
        readOnly: false,
        expanded: false,
        setExpanded: vi.fn(),
        ...overrides
    };

    render(
        <IntlProvider locale="en">
            <WysiwygFieldControl {...context} />
        </IntlProvider>
    );

    return screen.getByRole('button');
}

/**
 * The collapsed field is a **button beside** the preview, and the ARIA that
 * goes on it is the part that is easy to get wrong by analogy with every other
 * control on the form.
 *
 * The fixture is deliberately the worst case: a **required** field that is
 * **currently in error**. With a valid, optional field, `aria-invalid={!!error}`
 * and `aria-required={field.required}` would both render `"false"` — or be
 * omitted — and a control that had grown them would look identical to one that
 * had not. Here they would render `"true"`.
 */
describe('WysiwygFieldControl', () => {
    it('names the field and points at its error, and claims nothing else [wysiwyg:I-06]', () => {
        const button = renderControl();

        // content-admin's `<FieldLabel htmlFor>` names this element, so the id
        // has to be on the focusable thing rather than on the card around it.
        expect(button.getAttribute('id')).toBe('entry-field-body');
        // The error reaches assistive tech the one way it can on a button:
        // announced on focus, not only at the moment it appears.
        expect(button.getAttribute('aria-describedby')).toBe(
            'entry-field-body-error'
        );

        // Neither applies to a button — ARIA has no invalid state for one, and
        // `required` describes a field the user fills, not an action.
        expect(button.hasAttribute('aria-invalid')).toBe(false);
        expect(button.hasAttribute('aria-required')).toBe(false);
        // Nor does pressing it open anything: it navigates the work area.
        expect(button.hasAttribute('aria-haspopup')).toBe(false);
    });

    it('says what pressing it does, rather than just naming the field', () => {
        // A native `<label for>` outranks a button's own contents, which left
        // this announcing "Body" with no hint that it opens anything;
        // `aria-label` outranks the label in turn, and still contains the
        // visible label text so a speech-input user can say it (2.5.3).
        renderControl();

        expect(screen.getByRole('button', { name: 'Edit Body' })).toBeDefined();
    });

    it('offers a reader the view rather than the edit', () => {
        renderControl({ readOnly: true });

        expect(screen.getByRole('button', { name: 'View Body' })).toBeDefined();
    });
});
