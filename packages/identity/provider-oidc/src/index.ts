export { createOidcProvider } from './lib/oidc-provider';
export type { OidcProviderConfig, OidcEndpoints } from './lib/config';
export {
    createAuth0Provider,
    createEntraProvider,
    createGoogleProvider,
    createKeycloakProvider,
    createOktaProvider
} from './lib/presets';
export type { PresetConfig } from './lib/presets';
