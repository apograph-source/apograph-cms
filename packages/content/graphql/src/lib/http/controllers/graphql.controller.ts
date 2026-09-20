import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Logger,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
    ApiTokenGuard,
    ApiTokenWorkspaceGuard,
    CurrentApiToken,
    InjectContentRegistry,
    PublicEntriesQuery,
    PublicEntryWritesService,
    WorkspaceGrantsQuery,
    type ContentGrantsSource,
    type ContentTypeRegistry,
    type PublicApiToken
} from '@orthacms/content-server';
import {
    AccessPolicy,
    PERMISSIONS,
    Permission,
    Public,
    RequirePermissions,
    tokenActor,
    type PermissionKey
} from '@orthacms/identity-server';
import { CurrentWorkspace } from '@orthacms/workspaces-server';
import { printSchema, type ExecutionResult } from 'graphql';
import { InjectGraphqlConfig } from '../../content-graphql.tokens';
import { executeOperation } from '../../execution/execute-operation';
import { EntryLoader } from '../../resolvers/entry-loader';
import type { GraphqlContext } from '../../resolvers/context';
import { SchemaCache } from '../../schema/schema-cache';
import type { ResolvedContentGraphqlConfig } from '../../types/config';
import { GraphqlRequestDto } from '../dto/graphql-request.dto';

/**
 * `POST /api/v1/graphql` — the public content API over GraphQL.
 *
 * **An ordinary Nest controller, not `@nestjs/graphql`.** Two things fall out of
 * that, and both are the reason for it:
 *
 * - The **same guards** run here as on every other `/v1` route, as the same
 *   objects. `ApiTokenGuard` authenticates the bearer and checks `content:read`
 *   against the token's scope; `ApiTokenWorkspaceGuard` resolves which of the
 *   token's workspaces this request targets. There is no second authentication
 *   path to keep in step, which is exactly the sort of drift a security boundary
 *   cannot afford.
 * - The **schema can vary per request**. `GraphQLModule.forRoot` fixes one
 *   schema at boot; this builds (and caches) one per workspace grant set, so a
 *   token can no more enumerate the content model here than it can through
 *   `/v1/content-types`.
 *
 * `@RequirePermissions(CONTENT_READ)` is the floor for touching the endpoint at
 * all. It cannot be the whole story — one endpoint serves reads and writes — so
 * each mutation resolver asserts its own permission through the `assert` closure
 * built below, against the same `AccessPolicy` this guard consults.
 *
 * **A resolver failure is an HTTP 200 with an `errors` array.** That is how
 * GraphQL works, and it is the one thing a consumer porting from REST has to
 * adjust to: the status they used to branch on now travels in
 * `extensions.status`.
 *
 * **No `OriginGuard`**, for the same reason the REST write routes carry none: a
 * bearer token is never sent ambiently by a browser, so there is nothing to
 * forge, and demanding an `Origin` header would reject every server-side client.
 */
@Public()
@UseGuards(ApiTokenGuard, ApiTokenWorkspaceGuard)
@RequirePermissions(PERMISSIONS.CONTENT_READ)
@ApiSecurity('apiToken')
@ApiTags('Public GraphQL API')
@ApiHeader({
    name: 'X-Workspace-Id',
    required: false,
    description:
        "The workspace to act in. Required when the token covers more than one workspace; optional when it covers exactly one. A workspace outside the token's bucket is a 403. It also selects the schema: the SDL describes exactly this workspace's granted content types."
})
@Controller('v1/graphql')
export class GraphqlController {
    private readonly logger = new Logger(GraphqlController.name);
    private readonly schemas: SchemaCache;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @InjectGraphqlConfig()
        private readonly config: ResolvedContentGraphqlConfig,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly entries: PublicEntriesQuery,
        private readonly writes: PublicEntryWritesService,
        private readonly accessPolicy: AccessPolicy
    ) {
        this.schemas = new SchemaCache(registry, config.schemaCacheTtlMs);
    }

    /** `POST /api/v1/graphql` — run one query or mutation. */
    @Post()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Execute a GraphQL query or mutation',
        description:
            'The same content, permissions, and visibility rules as `/v1/content`, over GraphQL. The schema is derived from the resolved workspace’s content grants — `GET /v1/graphql` returns it as SDL. Field errors are reported in `errors` with the equivalent REST status in `extensions.status`; the HTTP status is 200 whenever the operation ran at all.'
    })
    async execute(
        @Body() body: GraphqlRequestDto,
        @CurrentApiToken() token: PublicApiToken,
        @CurrentWorkspace() workspaceId: string
    ): Promise<ExecutionResult> {
        const granted = await this.grants.grantedSlugs(workspaceId);
        return executeOperation(
            this.schemas.get(granted),
            body,
            this.contextFor(token, workspaceId, granted),
            this.config.limits,
            this.logger
        );
    }

    /**
     * `GET /api/v1/graphql` — this token's schema, as SDL.
     *
     * Introspection is enabled, so this is a convenience rather than the only
     * way in — but it is the one that fits a build step: point a codegen tool at
     * it and get types for exactly the content this workspace exposes. Two
     * tokens with different grants legitimately get different documents.
     */
    @Get()
    @Header('Content-Type', 'text/plain; charset=utf-8')
    @ApiOperation({
        summary: 'Read the schema for this token’s workspace, as SDL',
        description:
            'The SDL of the schema `POST /v1/graphql` will execute against. Scoped to the resolved workspace’s content grants, so an ungranted content type does not appear — the GraphQL equivalent of `/v1/content-types` pruning its list.'
    })
    async sdl(@CurrentWorkspace() workspaceId: string): Promise<string> {
        const granted = await this.grants.grantedSlugs(workspaceId);
        return printSchema(this.schemas.get(granted));
    }

    /**
     * Assembles the per-request context the resolvers read their collaborators
     * from. A fresh {@link EntryLoader} each time — it batches within one
     * execution and must never outlive it, or a second request could be served
     * another request's rows.
     */
    private contextFor(
        token: PublicApiToken,
        workspaceId: string,
        granted: ReadonlySet<string>
    ): GraphqlContext {
        const can = (permission: PermissionKey): boolean =>
            this.accessPolicy.can(
                tokenActor(token),
                Permission.create(permission)
            );
        // The grant set is read once per request and reused by every resolver:
        // one document resolves many types, and they must all see one consistent
        // set — as well as not provoking a query each.
        const grants: ContentGrantsSource = {
            grantedSlugs: async () => granted
        };
        return {
            workspaceId,
            token,
            registry: this.registry,
            grants,
            entries: this.entries,
            writes: this.writes,
            loader: new EntryLoader(this.entries, workspaceId),
            limits: this.config.limits,
            can,
            assert: (permission) => {
                if (!can(permission)) {
                    throw new ForbiddenException(
                        `This token’s scope does not allow ${permission}.`
                    );
                }
            }
        };
    }
}
