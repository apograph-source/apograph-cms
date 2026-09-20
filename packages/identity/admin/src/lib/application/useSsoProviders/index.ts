import { useQuery } from '@tanstack/react-query';
import { STALE_TIME, type ApiError } from '@orthacms/utils-admin';
import { httpAuthGateway } from '../../infrastructure/httpAuthGateway';
import type { SsoProviderSummary } from '../../../types/auth';

/** Query key for the deployment's SSO providers. */
export const ssoProvidersKey = ['auth', 'sso', 'providers'] as const;

/**
 * The single sign-on providers this deployment offers
 * (`GET /api/auth/sso`), for the sign-in page's buttons.
 *
 * **Failures are not surfaced.** The list is an *addition* to the sign-in page,
 * and the password form works without it. A visitor who cannot reach this
 * endpoint should still be able to sign in, not read an error about a feature
 * they may not even use — so the component treats an error the same as an empty
 * list, and one retry covers the transient case.
 *
 * The registered set changes only when an operator redeploys, so the answer is
 * cached for the life of the page.
 */
export function useSsoProviders() {
    return useQuery<SsoProviderSummary[], ApiError>({
        queryKey: ssoProvidersKey,
        queryFn: () => httpAuthGateway.listSsoProviders(),
        retry: 1,
        staleTime: STALE_TIME.Forever
    });
}
