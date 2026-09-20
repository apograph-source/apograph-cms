import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { Button } from '@orthacms/design-system';
import type { FilterGroup } from '../../../types/filter-tree.type';
import { treeToJsonNode } from '../../../utils/treeToJsonFilter';

const messages = defineMessages({
    title: { id: 'qb.preview.title', defaultMessage: 'JSON preview' },
    empty: {
        id: 'qb.preview.empty',
        defaultMessage:
            'No conditions yet — add a rule to see the wire payload.'
    },
    copy: { id: 'qb.preview.copy', defaultMessage: 'Copy' },
    copied: { id: 'qb.preview.copied', defaultMessage: 'Copied' }
});

/** Props for {@link JsonPreview}. */
export type JsonPreviewProps = {
    /** Live draft tree from the QueryBuilder. */
    tree: FilterGroup | null;
};

/**
 * Collapsible read-out of the JSON payload the builder will send. Collapsed by
 * default (it's a power-user confidence signal, not the primary content);
 * expanding shows the live wire format and a Copy affordance so it's pasteable
 * into curl, a support ticket, or a DevTools breakpoint.
 */
export function JsonPreview({ tree }: JsonPreviewProps) {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    // Pin `now` to the tree itself so `within_last` cutoffs don't drift
    // every render (e.g. as the user types in another rule). The user
    // sees a stable timestamp; Apply still resolves a fresh `now`.
    const now = useMemo(() => new Date(), [tree]);
    const node = treeToJsonNode(tree, now);
    const json = node ? JSON.stringify(node, null, 2) : null;

    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        if (!json) return;
        // Guarded: `writeText` rejects over plain HTTP, in a cross-origin
        // iframe, and whenever clipboard permission is denied. Unguarded, the
        // click handler's promise rejected with nothing listening — an
        // unhandled rejection in the console and a button that silently did
        // not flip to "Copied". Swallowing the rejection leaves the button in
        // its resting state, which is the honest signal that nothing was
        // copied.
        try {
            await navigator.clipboard.writeText(json);
        } catch {
            return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                    {open ? (
                        <ChevronDown aria-hidden className="size-3.5" />
                    ) : (
                        <ChevronRight aria-hidden className="size-3.5" />
                    )}
                    {intl.formatMessage(messages.title)}
                </button>
                {open && json && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onCopy}
                        aria-label={intl.formatMessage(
                            copied ? messages.copied : messages.copy
                        )}
                    >
                        {copied ? (
                            <Check aria-hidden className="size-3.5" />
                        ) : (
                            <Copy aria-hidden className="size-3.5" />
                        )}
                        {intl.formatMessage(
                            copied ? messages.copied : messages.copy
                        )}
                    </Button>
                )}
            </div>
            {open && (
                <pre className="max-h-48 overflow-auto rounded-md border bg-background p-3 text-xs font-mono leading-relaxed text-foreground">
                    {json ?? (
                        <span className="text-muted-foreground italic">
                            {intl.formatMessage(messages.empty)}
                        </span>
                    )}
                </pre>
            )}
        </div>
    );
}
