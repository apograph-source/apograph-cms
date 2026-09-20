import {
    ENTRY_FIELD_CONTROL_SLOT,
    type EntryFieldControlItem
} from '@orthacms/content-admin';
import { WysiwygPlugin } from '.';

/**
 * The plugin is **not a place in the app**. Its whole surface is one
 * contribution to content-admin's field-control slot, which is what makes it
 * appear in a collection's records editor, a single page, and inside a
 * localized type's Translated/Shared groups without knowing any of them exist.
 *
 * A route or a nav item here would be a second, wrong answer to "where is rich
 * text?" — and it is exactly the kind of thing that gets added by accident,
 * because every other admin plugin in the repo has one.
 */
describe('WysiwygPlugin', () => {
    it('contributes nothing but slots — no route, no nav, no layout [wysiwyg:I-01]', () => {
        // The whole key set, not a spot-check for `routes`: the point is that
        // there is nothing else, and `AdminPlugin` has several other optional
        // fields (nav entries, a layout, an init hook) that would each be a
        // place in the app.
        expect(Object.keys(WysiwygPlugin()).sort()).toEqual(['name', 'slots']);
    });

    it('fills exactly one slot, with exactly one item', () => {
        const plugin = WysiwygPlugin();

        expect(plugin.name).toBe('wysiwyg');
        expect(plugin.slots).toHaveLength(1);
        expect(plugin.slots?.[0].slot).toBe(ENTRY_FIELD_CONTROL_SLOT);
        expect(plugin.slots?.[0].items).toHaveLength(1);
    });

    it('offers both halves of the field control', () => {
        // `Component` is the field in the form; `FullView` is what it expands
        // into. An item with no `FullView` makes `setExpanded` a no-op, which
        // would look like "pressing the field does nothing".
        const [item] = (WysiwygPlugin().slots?.[0].items ??
            []) as EntryFieldControlItem[];

        expect(item.id).toBe('wysiwyg.entry.richtext');
        expect(typeof item.Component).toBe('function');
        expect(typeof item.FullView).toBe('function');
    });
});
