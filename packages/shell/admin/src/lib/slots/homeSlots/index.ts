import type { ComponentType } from 'react';
import { createSlot } from '@orthacms/utils-admin';

/**
 * Which region of the home dashboard a {@link HomeSectionItem} renders in.
 * `stat` items flow into the top metric row; `panel` items tile into the
 * two-column grid below it.
 */
export type HomeRegion = 'stat' | 'panel';

/**
 * A section contributed to the home dashboard. It is an arbitrary component the
 * contributing plugin renders itself (so it can be backed by a query), placed
 * by `region` and sorted by `order`. Keeps the shell's `HomePage` free of any
 * feature-plugin dependency — Workspaces contributes the stat tiles + a
 * workspaces panel, Activity contributes a recent-activity panel.
 */
export type HomeSectionItem = {
    /** Stable id (also the React key). */
    id: string;
    /** Which region to render in. */
    region: HomeRegion;
    /** Sort order within its region; lower appears first. */
    order: number;
    /** The section to render. Receives no props — it reads what it needs. */
    Component: ComponentType;
};

/**
 * The home dashboard's section slot. Any plugin contributes a
 * {@link HomeSectionItem} via its `slots`; {@link HomePage} reads it, splits by
 * `region`, and renders each sorted by `order`.
 */
export const HOME_SECTION_SLOT =
    createSlot<HomeSectionItem>('shell.home.section');
