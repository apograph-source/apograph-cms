import type { ComponentType } from 'react';
import { createSlot } from '@orthacms/utils-admin';

/** Props a {@link CommandSection} component receives from the palette. */
export type CommandSectionProps = {
    /** Closes the palette — call it after navigating on select. */
    close: () => void;
};

/**
 * A result section contributed to the global command palette. It is an
 * arbitrary component the contributing plugin renders itself — a `CommandGroup`
 * of `CommandItem`s backed by a query — so plugins can add dynamic results
 * (Workspaces, content types) without the shell depending on them. Rendered
 * inside the palette's `CommandList`, sorted by `order`, after the static
 * "Go to" nav group.
 */
export type CommandSection = {
    /** Stable id (also the React key). */
    id: string;
    /** Sort order; lower appears first. */
    order: number;
    /** The section to render; receives {@link CommandSectionProps}. */
    Component: ComponentType<CommandSectionProps>;
};

/**
 * The command-palette slot. Any plugin contributes a {@link CommandSection} via
 * its `slots`; {@link SidebarSearch} renders them (sorted by `order`) inside the
 * palette's list. Mounts only while the palette is open.
 */
export const COMMAND_SLOT = createSlot<CommandSection>('shell.command');
