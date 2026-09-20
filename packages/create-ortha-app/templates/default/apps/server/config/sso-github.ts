// ortha:if sso-github
import type { GithubProviderConfig } from '@orthacms/identity-provider-github';
import { defined, readEnv, readList } from '@orthacms/utils-server';

/**
 * The GitHub provider, or nothing.
 *
 * Present only when both values are set. The secret is not optional the way an
 * OIDC one can be: GitHub's code exchange has no PKCE, so the secret is the
 * only thing proving the code is being redeemed by this application — and the
 * adapter refuses at construction rather than at the first sign-in, because
 * every SSO failure looks the same to whoever clicked the button.
 */
export function githubProvider():
    | (GithubProviderConfig & { name: string })
    | undefined {
    const clientId = readEnv('SSO_GITHUB_CLIENT_ID');
    const clientSecret = readEnv('SSO_GITHUB_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
        return undefined;
    }
    // `.env` ships this key blank, and `readList` answers a blank with `[]` —
    // which is a value, not an absence, so passing it straight through would
    // request *no* scopes and leave the profile read with nothing to read.
    const scopes = readList('SSO_GITHUB_SCOPES', '');
    return defined({
        name: readEnv('SSO_GITHUB_NAME') ?? 'github',
        clientId,
        clientSecret,
        label: readEnv('SSO_GITHUB_LABEL'),
        // Defaults to `read:user user:email` — a profile and the verified
        // addresses on it. GitHub's scopes are coarse, so anything wider hands
        // the CMS access it has no use for.
        scopes: scopes.length > 0 ? scopes : undefined,
        // Only for GitHub Enterprise Server; github.com needs none.
        enterpriseBaseUrl: readEnv('SSO_GITHUB_ENTERPRISE_BASE_URL'),
        // Cosmetic, like Google's `hd`: it shapes the account chooser. Who
        // actually gets in is this CMS's own decision, not GitHub's.
        organization: readEnv('SSO_GITHUB_ORGANIZATION')
    });
}
// ortha:end
