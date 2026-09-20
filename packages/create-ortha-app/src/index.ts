/**
 * Public API of `create-ortha-app`.
 *
 * The package is used through `npx`; these exports exist so the rendering,
 * feature resolution and validation are testable without spawning the binary.
 */
export {
    renderTemplate,
    renderManifest,
    render,
    isNonEmptyDirectory,
    type TemplateValues
} from './lib/template';
export { applyConditionals } from './lib/conditionals';
export {
    CORE_PACKAGES,
    CORE_DEV_PACKAGES,
    TRANSITIVE_PACKAGES,
    MEDIA_PROVIDERS,
    COPILOT_PROVIDERS,
    SSO_PROVIDERS,
    PROTOCOLS,
    ALL_FEATURES,
    resolvePackages,
    resolveDevPackages,
    resolveFlags,
    type Feature,
    type FeatureSelection
} from './lib/features';
export {
    validateAppName,
    validateDatabaseUrl,
    databaseNameFrom
} from './lib/validate';
