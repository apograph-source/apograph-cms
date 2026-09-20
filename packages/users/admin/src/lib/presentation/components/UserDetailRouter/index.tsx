import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import {
    AuthStatus,
    useAuth,
    useHasPermission
} from '@orthacms/identity-admin';
import { UserDetailLayout } from '../UserDetailLayout';
import { UserGeneralPage } from '../../pages/UserGeneralPage';
import { UserRolesPage } from '../../pages/UserRolesPage';
import { UserWorkspacesPage } from '../../pages/UserWorkspacesPage';
import { UserSessionsPage } from '../../pages/UserSessionsPage';
import { UserActivityPage } from '../../pages/UserActivityPage';
import { UserAccessPage } from '../../pages/UserAccessPage';
import { UserPreferencesPage } from '../../pages/UserPreferencesPage';

/**
 * The nested router for one member, mounted by the plugin at `/users/:id/*`.
 * Mirrors `IdentityRouter`: a single element owning its own `<Routes>`, with
 * the shared layout wrapping the tab pages and providing the member via Outlet
 * context.
 *
 * The Audit (Sessions, Activity) and Access tabs are permission-gated at the
 * route level — without the permission the route redirects to General, so a
 * deep link or stale bookmark can't reach a tab the side rail hides. The
 * Preferences tab is **self-only** — it is the current user's own app
 * preferences (theme), so it is gated on the viewed profile being the caller's
 * own, and redirects to General on anyone else's profile. The index redirects
 * to General as the default tab.
 */
export function UserDetailRouter() {
    const canManage = useHasPermission('users:update');
    const canReadActivity = useHasPermission('activity:read');
    const { id } = useParams<{ id: string }>();
    const auth = useAuth();
    const isSelf =
        auth.status === AuthStatus.Authenticated && auth.user.id === id;

    return (
        <Routes>
            <Route element={<UserDetailLayout />}>
                <Route index element={<Navigate to="general" replace />} />
                <Route path="general" element={<UserGeneralPage />} />
                <Route path="roles" element={<UserRolesPage />} />
                <Route path="workspaces" element={<UserWorkspacesPage />} />
                <Route
                    path="sessions"
                    element={
                        canManage ? (
                            <UserSessionsPage />
                        ) : (
                            <Navigate to="../general" replace />
                        )
                    }
                />
                <Route
                    path="activity"
                    element={
                        canReadActivity ? (
                            <UserActivityPage />
                        ) : (
                            <Navigate to="../general" replace />
                        )
                    }
                />
                <Route
                    path="access"
                    element={
                        canManage ? (
                            <UserAccessPage />
                        ) : (
                            <Navigate to="../general" replace />
                        )
                    }
                />
                <Route
                    path="preferences"
                    element={
                        isSelf ? (
                            <UserPreferencesPage />
                        ) : (
                            <Navigate to="../general" replace />
                        )
                    }
                />
                <Route path="*" element={<Navigate to="general" replace />} />
            </Route>
        </Routes>
    );
}
