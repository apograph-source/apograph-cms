import { useEffect, useMemo, useState } from 'react';
import { Input } from '@orthacms/design-system';

/** Props for {@link CsvValueInput}. */
export type CsvValueInputProps = {
    /** Current applied value (array of trimmed, non-empty items). */
    value: string[];
    /** Called on blur with the parsed array — never on every keystroke. */
    onChange: (next: string[]) => void;
    placeholder?: string;
    className?: string;
    /** Accessible name for the input (no visible label sits beside it). */
    ariaLabel?: string;
    /** Marks the input `aria-invalid` when the rule fails validation. */
    invalid?: boolean;
    /** Id of the rule's error message, wired as `aria-describedby`. */
    describedById?: string;
};

/**
 * Comma-separated value editor that keeps the raw input string in
 * local state. The parsed array is pushed to the parent on every
 * keystroke (so previews stay live), but the input itself always
 * reads from the local draft — never from `value` round-tripped
 * through `.join(',')` — so trailing commas / pauses / mid-token
 * cursor moves are preserved. On blur the draft is normalised to
 * its canonical form so a stray `a,,b` cleans up to `a,b`.
 */
export function CsvValueInput({
    value,
    onChange,
    placeholder = 'value1,value2',
    className = 'w-48',
    ariaLabel,
    invalid,
    describedById
}: CsvValueInputProps) {
    const [draft, setDraft] = useState(() => value.join(','));
    const canonicalValue = useMemo(() => value.join(','), [value]);

    // Re-sync from props only when the canonical (parsed) form would
    // differ — e.g. the parent reset the value because the operator
    // changed. Comparing canonicals avoids fighting our own onChange
    // echo (we just pushed `value` upward; we don't want to overwrite
    // the live draft with the joined form on the next render).
    useEffect(() => {
        setDraft((current) =>
            parse(current).join(',') === canonicalValue
                ? current
                : canonicalValue
        );
    }, [canonicalValue]);

    const handleChange = (raw: string) => {
        setDraft(raw);
        onChange(parse(raw));
    };

    const handleBlur = () => {
        const items = parse(draft);
        setDraft(items.join(','));
    };

    return (
        <Input
            placeholder={placeholder}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedById}
            className={className}
        />
    );
}

function parse(raw: string): string[] {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
