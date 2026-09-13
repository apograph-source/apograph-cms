import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OP } from '../types/filter-tree.type';
import type { RelationValueEditorProps } from '../types/filter-field.type';
import { ControlledBuilder, group, renderIntl, rule } from './__test__/harness';
import { usePortalContainer } from './portalContainer';

/**
 * Where the builder's nested popovers portal to. This is a *wheel-scrolling*
 * regression, and a wheel is exactly what a browser test cannot usefully
 * assert about — react-remove-scroll's block is a `wheel` listener on the
 * document, so the only observable that separates the two behaviours is which
 * subtree the popover was mounted into.
 */

/** A stand-in for the consumer's injected record picker, reporting what it read. */
function RelationEditor(props: RelationValueEditorProps) {
    const container = usePortalContainer();
    return (
        <span
            data-testid="relation-editor"
            data-target={props.target}
            data-container-id={container?.id}
        />
    );
}

/** A tree whose single rule is a relation id, so the injected editor is drawn. */
const relationRule = () =>
    group('root', [rule('r1', 'author.id', OP.Equals, '')]);

let locked: HTMLElement | null = null;

/** The scroll-locking ancestor a drawer or dialog would hand the builder. */
function lockingContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'scroll-locked';
    document.body.appendChild(el);
    locked = el;
    return el;
}

afterEach(() => {
    locked?.remove();
    locked = null;
});

describe('portalContainer', () => {
    it('portals the field picker into the scroll-locking container [query-builder:I-20]', () => {
        const container = lockingContainer();
        renderIntl(
            <ControlledBuilder
                initial={relationRule()}
                portalContainer={container}
                renderRelationValue={(p) => <RelationEditor {...p} />}
            />
        );

        fireEvent.click(
            screen.getByRole('combobox', {
                name: 'Field for Author · Author record'
            })
        );

        // Inside the container's own subtree — react-remove-scroll allow-lists
        // it, so the list scrolls by wheel. On `document.body` the scrollbar
        // still drags and the wheel does nothing.
        expect(container.contains(screen.getByRole('listbox'))).toBe(true);
    });

    it('publishes the same container to an injected relation editor [query-builder:I-20]', () => {
        const container = lockingContainer();
        renderIntl(
            <ControlledBuilder
                initial={relationRule()}
                portalContainer={container}
                renderRelationValue={(p) => <RelationEditor {...p} />}
            />
        );

        // The consumer's editor holds a popover of its own and cannot be
        // passed the node directly — the builder has no prop for it — so the
        // context is the only route, and both halves of the invariant depend
        // on it being read.
        expect(
            screen
                .getByTestId('relation-editor')
                .getAttribute('data-container-id')
        ).toBe('scroll-locked');
    });

    it('keeps the body portal when there is no locking container [query-builder:I-20]', () => {
        const container = lockingContainer();
        renderIntl(
            <ControlledBuilder
                initial={relationRule()}
                renderRelationValue={(p) => <RelationEditor {...p} />}
            />
        );

        fireEvent.click(
            screen.getByRole('combobox', {
                name: 'Field for Author · Author record'
            })
        );

        // The negative control the two assertions above need: with no
        // container the popover really does land elsewhere, so "it is inside
        // the container" is a claim the DOM can refute rather than one that
        // holds by construction.
        expect(container.contains(screen.getByRole('listbox'))).toBe(false);
        expect(
            screen
                .getByTestId('relation-editor')
                .getAttribute('data-container-id')
        ).toBeNull();
    });
});
