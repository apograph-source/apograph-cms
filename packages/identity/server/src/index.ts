export type {
    IdentityPluginConfig,
    IdentitySessionConfig,
    IdentityTokenConfig,
    IdentityRateLimitConfig,
    IdentityRootAdminConfig,
    IdentitySsoConfig,
    IdentitySsoProvisioningConfig
} from './lib/types';
export { IdentityPlugin } from './lib/utils/identity-plugin';
export type {
    IdentityServerPlugin,
    IdentityPluginOptions,
    IdentitySsoOptions
} from './lib/utils/identity-plugin';
export { IdentityModule } from './lib/identity.module';
// The identity config token, exported so the users plugin's invite issuer can
// read the host-configured invite TTL instead of hard-coding one.
export { IDENTITY_CONFIG, InjectIdentityConfig } from './lib/identity.tokens';
export {
    MIN_PASSWORD_LENGTH,
    MAX_PASSWORD_LENGTH,
    // The ceiling is a BYTE bound (bcrypt's truncation point), so anything
    // enforcing it must measure the same way this does.
    passwordByteLength
} from './lib/auth/auth.constants';
export { AuthGuard } from './lib/auth/guards/auth.guard';
// The SSO attempt cookie's name, exported for the same reason `SESSION_COOKIE`
// is: the e2e harness drives the handshake with a real browser cookie jar, and
// hard-coding the string in a suite is how it drifts from the one the server
// sets.
export { SSO_REQUEST_COOKIE } from './lib/auth/services/cookie.service';
export { OriginGuard } from './lib/auth/guards/origin.guard';
export { Public } from './lib/auth/decorators/public.decorator';
export { CurrentUser } from './lib/auth/decorators/current-user.decorator';
export type { AuthenticatedRequest } from './lib/auth/decorators/current-user.decorator';
export type { PublicUser } from './lib/auth/services/auth.service';
export {
    PERMISSIONS,
    PERMISSION_KEYS,
    SYSTEM_ROLES
} from './lib/rbac/system-roles';
export type { PermissionKey, SystemRole } from './lib/rbac/system-roles';
export { seedSystemRoles } from './lib/rbac/seeders/seed-system-roles';
export { RolesService } from './lib/rbac/services/roles.service';
export { PermissionsService } from './lib/rbac/services/permissions.service';
export { PermissionsGuard } from './lib/rbac/guards/permissions.guard';
export {
    RequireAnyPermission,
    RequirePermissions
} from './lib/rbac/decorators/require-permissions.decorator';
// The pieces a plugin needs to write its OWN permission-checking guard for a
// non-session caller (the public content API's bearer guard is the one such
// caller today): the metadata key `@RequirePermissions` writes, the permission
// value object, and the pure RBAC decision every guard must delegate to — so
// "may this actor do this?" has exactly one implementation in the codebase.
export { PERMISSIONS_KEY } from './lib/rbac/decorators/require-permissions.decorator';
export { Permission } from './lib/domain/value-objects/permission';
export { AccessPolicy } from './lib/domain/access-policy';
export type { Actor, PermissionScope } from './lib/domain/access-policy';
export { RoleNotFoundError, SystemRoleProtectedError } from './lib/rbac/errors';
// Credential rotation. Exported ahead of the controller that will wire it (the
// self-service change / reset flows), so the server-e2e suite can drive the
// real use case out of DI — a flow that revokes sessions and writes an audit
// row is not something to leave unexercised until a route shows up.
export { ChangePasswordUseCase } from './lib/application/use-cases/change-password.use-case';
export type { ChangePasswordOptions } from './lib/application/use-cases/change-password.use-case';
export { PasswordTooLongError } from './lib/auth/errors';
export { RootAdminService } from './lib/root-admin/services/root-admin.service';
export type {
    RootAdminOutcome,
    RootAdminBootstrapResult
} from './lib/root-admin/services/root-admin.service';
export { MissingRootAdminPasswordError } from './lib/root-admin/errors';
export { ACTIVITY_RECORDER } from './lib/activity/activity-recorder';
export type {
    ActivityRecorder,
    ActivityRecordInput,
    ActivityExecutor
} from './lib/activity/activity-recorder';
export { IDENTITY_ACTIVITY_KINDS } from './lib/activity/activity-kinds';
export type { IdentityActivityKind } from './lib/activity/activity-kinds';
export * from './lib/schema';
// External-API bearer tokens. The service mints, lists, and revokes them; the
// scope helper is the contract for turning a token's scope into a permission
// set. The guard that authenticates `Authorization: Bearer` on the public
// content API ships with that API.
export { ApiTokenService } from './lib/api-tokens/application/api-token.service';
export type {
    ApiTokenView,
    MintApiTokenInput,
    MintedApiToken
} from './lib/api-tokens/application/api-token.service';
// The verified-token record (row + workspace bucket) — what `verify` returns,
// and what the public content API's bearer guard scopes a request with.
export type {
    ApiTokenRecord,
    ApiTokenRow
} from './lib/api-tokens/infrastructure/persistence/drizzle-api-token.repository';
export {
    API_TOKEN_SCOPES,
    scopePermissions,
    tokenActor
} from './lib/api-tokens/domain/api-token-scope';
export type {
    ApiTokenScope,
    ScopedToken
} from './lib/api-tokens/domain/api-token-scope';
// The workspace-existence port a token's bucket is validated against. Identity
// owns it and the workspaces plugin binds it — the same inversion as
// `ACTIVITY_RECORDER`, keeping the package graph acyclic.
export { WORKSPACE_DIRECTORY } from './lib/api-tokens/application/ports/workspace-directory.port';
export type { WorkspaceDirectory } from './lib/api-tokens/application/ports/workspace-directory.port';
export { UnknownWorkspaceError } from './lib/api-tokens/domain/unknown-workspace.error';
// --- SSO ---
//
// The port itself lives in `@orthacms/identity-domain`, so an adapter can
// depend on it without depending on this package. What is re-exported here is
// what a *host* or a sibling plugin needs: the registry builder (for a test
// harness that wires its own module), the generic sign-in failure, and the
// callback-URL helper an operator needs when registering a client with their
// identity provider.
export { buildSsoRegistry } from './lib/infrastructure/sso-registry';
export { SsoLoginFailedError } from './lib/domain/errors';
export {
    ssoCallbackUrl,
    ssoPublicBaseUrl,
    DEFAULT_SSO_REQUEST_TTL_SECONDS
} from './lib/sso/sso-settings';
export { SSO_IDENTITY_REPOSITORY } from './lib/domain/sso-identity.repository';
export type {
    SsoIdentityLink,
    SsoIdentityRepository,
    LinkSsoIdentityInput
} from './lib/domain/sso-identity.repository';
export { SSO_PROVISIONING_REPOSITORY } from './lib/domain/sso-provisioning.repository';
export type {
    SsoProvisioningRepository,
    ProvisionAccountInput,
    ProvisionedAccount
} from './lib/domain/sso-provisioning.repository';
// The domain-allow-list check, exported because it is the rule an operator's
// configuration is judged against and a host may want to apply it before
// writing one.
export {
    isProvisionableEmail,
    assertProvisionableDomains
} from './lib/domain/sso-provisioning-policy';
export { SSO_AUTH_REQUEST_REPOSITORY } from './lib/domain/sso-auth-request.repository';
export type {
    SsoAuthRequestRepository,
    PendingSsoAuthRequest,
    StartedSsoAuthRequest,
    OpenSsoAuthRequestInput
} from './lib/domain/sso-auth-request.repository';
