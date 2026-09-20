import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    WORKSPACE_ROUTE_SLOT,
    WORKSPACE_NAV_SLOT
} from '@orthacms/workspaces-admin';
import {
    CONTENT_FIELD_TYPE,
    ENTRY_PRESAVE_SLOT,
    ENTRY_TAB,
    ENTRY_TAB_SLOT,
    type ContentTypeDetail
} from '@orthacms/content-admin';
import { WYSIWYG_MEDIA_SLOT } from '@orthacms/wysiwyg-admin';
import {
    INSIGHTS_SECTION_IDS,
    INSIGHTS_WIDGET_SLOT
} from '@orthacms/insights-admin';
import { Image, Upload } from 'lucide-react';
import { MediaStorageStat } from '../../components/MediaStorageStat';
import { MediaStorageWidget } from '../../components/MediaStorageWidget';
import { MediaUploadsWidget } from '../../components/MediaUploadsWidget';
import { MediaAltTextWidget } from '../../components/MediaAltTextWidget';
import { EntryMediaTab } from '../../components/EntryMediaTab';
import { MediaLibraryPageSkeleton } from '../../components/MediaLibrarySkeleton';
import { WysiwygLibrarySource } from '../../components/WysiwygLibrarySource';
import { WysiwygUploadSource } from '../../components/WysiwygUploadSource';
import {
    MEDIA_PRESAVE_ID,
    usePendingMediaUploads
} from '../../hooks/usePendingMediaUploads';
import { MEDIA_READ } from '../../constants';

const MediaLibraryPage = lazy(() =>
    import('../../pages/MediaLibraryPage').then((module) => ({
        default: module.MediaLibraryPage
    }))
);

/** The Media tab applies to any type that declares a media field. */
function hasMediaField(schema: ContentTypeDetail): boolean {
    return schema.fields.some(
        (field) => field.type === CONTENT_FIELD_TYPE.Media
    );
}

/**
 * Admin-side media plugin shape. A thin alias of {@link AdminPlugin}, kept named
 * so future config has a home.
 */
export type MediaAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side Media Library plugin. It lives **strictly inside a
 * workspace**: it contributes no top-level route and no top-toolbar nav entry,
 * only a rail button (`order: 20`) + a route to the workspace shell's slots
 * (owned by `@orthacms/workspaces-admin`). Register it after
 * `WorkspacesPlugin()` so those slots exist.
 */
export function MediaPlugin(): MediaAdminPlugin {
    return {
        name: 'media',
        slots: [
            {
                // Insights widgets. Media owns `media_asset`, so it owns the
                // cards reading it — the Insights plugin knows nothing about
                // assets, kinds or bytes.
                slot: INSIGHTS_WIDGET_SLOT,
                items: [
                    {
                        id: 'insights.media.storage',
                        section: INSIGHTS_SECTION_IDS.Overview,
                        order: 40,
                        size: 'xs',
                        permission: MEDIA_READ,
                        titleId: 'media.insights.storage.label',
                        defaultTitle: 'Media storage',
                        Component: MediaStorageStat
                    },
                    {
                        id: 'insights.media.storageBreakdown',
                        section: INSIGHTS_SECTION_IDS.Reach,
                        order: 10,
                        size: 'sm',
                        permission: MEDIA_READ,
                        titleId: 'media.insights.storageBreakdown.title',
                        defaultTitle: "What's using the storage",
                        Component: MediaStorageWidget
                    },
                    {
                        id: 'insights.media.uploads',
                        section: INSIGHTS_SECTION_IDS.Reach,
                        order: 20,
                        size: 'sm',
                        permission: MEDIA_READ,
                        titleId: 'media.insights.uploads.title',
                        defaultTitle: 'Uploads',
                        Component: MediaUploadsWidget
                    },
                    {
                        id: 'insights.media.alt',
                        section: INSIGHTS_SECTION_IDS.Reach,
                        order: 30,
                        size: 'sm',
                        permission: MEDIA_READ,
                        titleId: 'media.insights.alt.title',
                        defaultTitle: 'Images missing alt text',
                        Component: MediaAltTextWidget
                    }
                ]
            },
            {
                slot: WORKSPACE_NAV_SLOT,
                items: [
                    {
                        labelId: 'media.nav.label',
                        defaultLabel: 'Media Library',
                        to: 'media',
                        order: 20,
                        icon: Image,
                        iconColor: 'text-nav-teal'
                    }
                ]
            },
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        path: 'media/*',
                        element: (
                            <Suspense fallback={<MediaLibraryPageSkeleton />}>
                                <MediaLibraryPage />
                            </Suspense>
                        )
                    }
                ]
            },
            // The entry editor's Media tab — rendered by content-admin's
            // ENTRY_TAB_SLOT only when the open type has a media field, so the
            // tab appears exactly where media applies. Its `slug` is content's
            // own `media` tab route, already accepted by the tab router.
            {
                slot: ENTRY_TAB_SLOT,
                items: [
                    {
                        id: 'media.entry.tab',
                        slug: ENTRY_TAB.Media,
                        label: {
                            id: 'media.tab.label',
                            defaultMessage: 'Media'
                        },
                        order: 10,
                        appliesTo: hasMediaField,
                        Component: EntryMediaTab
                    }
                ]
            },
            // Rich text gets the library too. The editor
            // (`@orthacms/wysiwyg-admin`) declares `WYSIWYG_MEDIA_SLOT` and
            // knows only how to *hold* an image or a video; browsing folders
            // and uploading are this plugin's job, so it fills the seam rather
            // than the editor importing a library it would then be pinned to.
            //
            // Two entries, because they are different acts: pick something that
            // exists, or add something that doesn't. Both end with an asset in
            // the Media Library — an image in a body is a first-class asset,
            // not an orphan attachment.
            {
                slot: WYSIWYG_MEDIA_SLOT,
                items: [
                    {
                        id: 'media.wysiwyg.library',
                        label: {
                            id: 'media.wysiwyg.library',
                            defaultMessage: 'Media Library…'
                        },
                        icon: Image,
                        order: 10,
                        Source: WysiwygLibrarySource
                    },
                    {
                        id: 'media.wysiwyg.upload',
                        label: {
                            id: 'media.wysiwyg.upload',
                            defaultMessage: 'Upload files…'
                        },
                        icon: Upload,
                        order: 20,
                        Source: WysiwygUploadSource
                    }
                ]
            },
            // Files chosen on a media field are staged, not uploaded: this step
            // runs inside the record's save and puts them in the library then,
            // so an abandoned edit leaves no orphan assets behind. It also owns
            // the staging state, mounted above the tab body (a route) so it
            // survives switching tabs.
            {
                slot: ENTRY_PRESAVE_SLOT,
                items: [
                    {
                        id: MEDIA_PRESAVE_ID,
                        usePresave: usePendingMediaUploads
                    }
                ]
            }
        ]
    };
}
