import type { ContentTypeDescriptor } from '../../application/ports/content-type-descriptor';

/**
 * FALLBACK content catalogue, used only when no content plugin is registered to
 * bind {@link CONTENT_CATALOG} (e.g. the workspaces plugin booted standalone in
 * a test). When `@orthacms/content-server` is present, the code-defined
 * registry supersedes this. The `name` of each entry is the slug stored in
 * `workspace_content`.
 */
export const CONTENT_TYPES: readonly ContentTypeDescriptor[] = [
    {
        name: 'blog_post',
        kind: 'collection',
        label: 'Blog posts',
        description: 'Articles for the marketing blog.'
    },
    {
        name: 'product',
        kind: 'collection',
        label: 'Products',
        description: 'Catalog entries with pricing and media.'
    },
    {
        name: 'author',
        kind: 'collection',
        label: 'Authors',
        description: 'Bylines shared across posts.'
    },
    {
        name: 'release_note',
        kind: 'collection',
        label: 'Release notes',
        description: 'Versioned changelog entries.'
    },
    {
        name: 'home',
        kind: 'single',
        label: 'Home',
        description: 'The site landing page.',
        path: '/'
    },
    {
        name: 'about',
        kind: 'single',
        label: 'About',
        description: 'Company and team overview.',
        path: '/about'
    },
    {
        name: 'contact',
        kind: 'single',
        label: 'Contact',
        description: 'Contact form and details.',
        path: '/contact'
    },
    {
        name: 'pricing',
        kind: 'single',
        label: 'Pricing',
        description: 'Plans and pricing tiers.',
        path: '/pricing'
    }
] as const;
