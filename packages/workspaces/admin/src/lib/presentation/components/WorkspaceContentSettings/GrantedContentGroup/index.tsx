import { Separator } from '@orthacms/design-system';
import { GrantedContentRow, type GrantedContent } from '../GrantedContentRow';

/** Props for {@link GrantedContentGroup}. */
export type GrantedContentGroupProps = {
    /** Section heading (e.g. "Collections"). */
    heading: string;
    /** The granted items in this section. */
    items: GrantedContent[];
    /** Copy shown when the section has no grants. */
    emptyLabel: string;
    /** Whether remove controls should be offered. */
    canRemove: boolean;
    /** Called with the item to remove. */
    onRemove: (item: GrantedContent) => void;
};

/**
 * One kind's slice of the granted-content list — a heading with a count over a
 * bordered list of rows (or an empty hint). The heading conveys the kind, so the
 * rows drop their kind badge. Backs the Collections / Pages split.
 */
export function GrantedContentGroup({
    heading,
    items,
    emptyLabel,
    canRemove,
    onRemove
}: GrantedContentGroupProps) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
                {heading}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {items.length}
                </span>
            </span>
            {items.length === 0 ? (
                <p className="rounded-xl border px-3 py-4 text-sm text-muted-foreground">
                    {emptyLabel}
                </p>
            ) : (
                <ul className="rounded-xl border">
                    {items.map((item, index) => (
                        <li key={item.slug}>
                            {index > 0 ? <Separator /> : null}
                            <GrantedContentRow
                                granted={item}
                                canRemove={canRemove}
                                showKind={false}
                                onRemove={() => onRemove(item)}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
