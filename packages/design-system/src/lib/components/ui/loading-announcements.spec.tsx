import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppLoader } from './app-loader';
import { Skeleton, SkeletonRegion } from './skeleton';
import { Spinner } from './spinner';
import { WizardPageSkeleton } from './wizard-page-skeleton';

/**
 * ORT-161 / ORT-166 — who is allowed to say "busy", and how many of them there
 * are.
 *
 * `Spinner` used to carry `role="status"` on the bare `<svg>`. A live region
 * with no text in it announces nothing, so the role bought no announcement at
 * all while four spinners on one page created four regions competing to speak.
 * The fix reversed both halves: the placeholders went silent and decorative,
 * and the announcement moved to a wrapper that has words — `SkeletonRegion`,
 * `AppLoader`, `WizardPageSkeleton`.
 *
 * Counting is the whole point, so every count below is taken with
 * `{ hidden: true }`. The default query walks the accessibility tree and would
 * skip a `role="status"` that had crept back onto a placeholder *inside* the
 * region's `aria-hidden` wrapper — which is exactly where it would creep back
 * to, and a count that cannot see the regression is not a count.
 */
const liveRegions = () => screen.queryAllByRole('status', { hidden: true });

describe('decorative loading placeholders', () => {
    it('leaves a bare Spinner silent and out of the a11y tree [design-system:I-09]', () => {
        const { container } = render(<Spinner />);

        expect(liveRegions()).toHaveLength(0);
        expect(
            container.querySelector('svg')?.getAttribute('aria-hidden')
        ).toBe('true');
    });

    it('leaves a bare Skeleton silent [design-system:I-09]', () => {
        const { container } = render(
            <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
            </div>
        );

        expect(liveRegions()).toHaveLength(0);
        // No role at all, and nothing to read out: a placeholder that
        // announced itself would announce an empty string.
        expect(container.querySelector('[role]')).toBeNull();
        expect(container.textContent).toBe('');
    });
});

describe('announced loading surfaces', () => {
    it('gives a block of placeholders exactly one named region [design-system:I-09, design-system:I-10]', () => {
        // Six placeholders, one region. A fixture with a single placeholder
        // could not tell "one region per surface" from "one region per block",
        // which is the failure the Spinner half of ORT-161 removed.
        render(
            <SkeletonRegion label="Loading members…">
                {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-4 w-full" />
                ))}
            </SkeletonRegion>
        );

        const regions = liveRegions();
        expect(regions).toHaveLength(1);
        expect(regions[0].textContent).toContain('Loading members…');
        expect(regions[0].getAttribute('aria-busy')).toBe('true');
    });

    it('hides the placeholder structure inside the region [design-system:I-09]', () => {
        // A skeleton table is still a `<table>` to a screen reader, and its
        // empty rows read out under the status text as noise.
        const { container } = render(
            <SkeletonRegion label="Loading members…">
                <Skeleton className="h-4 w-full" />
            </SkeletonRegion>
        );

        expect(container.querySelector('[aria-hidden]')).not.toBeNull();
        expect(
            container.querySelector('[aria-hidden] [class*="animate-pulse"]')
        ).not.toBeNull();
    });

    it('gives the boot loader one region inside its landmark [design-system:I-10]', () => {
        render(<AppLoader label="Loading Ortha CMS…" />);

        const regions = liveRegions();
        expect(regions).toHaveLength(1);
        expect(regions[0].textContent).toContain('Loading Ortha CMS…');
        // The role sits on the inner block, not on the root: `role="status"`
        // on the `<main>` would override the landmark and give back the
        // "everything is outside a region" failure it was added to fix.
        expect(regions[0].tagName).not.toBe('MAIN');
        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('gives the wizard placeholder one region across all its blocks [design-system:I-10]', () => {
        // The widest surface the library ships: a stepper rail and a step card
        // built from a dozen placeholders. Still one region.
        const { container } = render(
            <WizardPageSkeleton label="Loading…" steps={4} fields={5} />
        );

        expect(
            container.querySelectorAll('[class*="animate-pulse"]').length
        ).toBeGreaterThan(10);
        expect(liveRegions()).toHaveLength(1);
    });
});
