import type { ComponentType, ReactNode } from 'react';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@orthacms/design-system';
import { ChevronRight } from 'lucide-react';

type CollapsibleGroupProps = {
    /** Group heading (e.g. "Collections"). */
    label: string;
    /** Leading icon, shown in a boxed badge. */
    icon: ComponentType<{ className?: string }>;
    /** Item count shown beside the heading. */
    count: number;
    /** Whether the group starts expanded. Defaults to collapsed. */
    defaultOpen?: boolean;
    /** The group's rows. */
    children: ReactNode;
};

/**
 * A collapsible nav section in the content sidebar (Collections / Pages), styled
 * after the shadcn `SidebarMenuButton` + `SidebarMenuSub`: a menu row — icon,
 * label, and count — that doubles as the collapse trigger (chevron rotates open;
 * Radix manages `aria-expanded` + `data-state`), with the rows nested under a
 * left border line. Starts collapsed; expanded, the rows show.
 *
 * A group holding **nothing** renders as a plain row instead: no trigger, no
 * chevron, no tab stop. There is nothing to reveal, so a control that announces
 * itself as expandable — and then opens an empty strip — is one WCAG 4.1.2 calls
 * a lie, and one a keyboard user meets as a dead stop mid-sidebar. The row still
 * shows, muted and counting zero: "this workspace has no pages yet" is a fact
 * worth reading, while a section that vanished reads as a bug.
 *
 * The muting is `/70`, the same level the live row's icon and chevron use, and
 * it is a floor rather than a taste: `sidebar-foreground/50` over `sidebar`
 * composites to 4.48:1, which misses AA's 4.5 by two hundredths and fails the
 * axe scan every entry-editor suite runs. Mute it further and the row stops
 * clearing 1.4.3.
 */
export function CollapsibleGroup({
    label,
    icon: Icon,
    count,
    defaultOpen = false,
    children
}: CollapsibleGroupProps) {
    if (count === 0) {
        return (
            <div className="flex h-9 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground/70">
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate font-medium">{label}</span>
                <span className="tabular-nums text-xs">{count}</span>
            </div>
        );
    }

    return (
        <Collapsible
            defaultOpen={defaultOpen}
            className="group/collapsible flex w-full flex-col"
        >
            <CollapsibleTrigger className="flex h-9 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <Icon className="size-4 shrink-0 text-sidebar-foreground/70" />
                <span className="flex-1 truncate font-medium">{label}</span>
                <span className="tabular-nums text-xs text-sidebar-foreground/60">
                    {count}
                </span>
                <ChevronRight className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="mx-3.5 mt-1 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5">
                    {children}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
