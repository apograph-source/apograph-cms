import { Module, type DynamicModule } from '@nestjs/common';
import {
    contentPublishGuardRegistrar,
    entryFilterProviderRegistrar
} from '@orthacms/content-server';
import { EntryReviewService } from './application/entry-review.service';
import { ProtectionRulesService } from './application/protection-rules.service';
import { ReviewQueueService } from './application/review-queue.service';
import { HeadRevisionQuery } from './infrastructure/head-revision.query';
import { ReviewApprovalRepository } from './infrastructure/review-approval.repository';
import { ReviewRequestRepository } from './infrastructure/review-request.repository';
import { EntryReviewController } from './http/controllers/entry-review.controller';
import { NewEntryProtectionController } from './http/controllers/new-entry-protection.controller';
import { ReviewerCandidatesQuery } from './infrastructure/reviewer-candidates.query';
import { ReviewQueueController } from './http/controllers/review-queue.controller';
import { ProtectionRuleRepository } from './infrastructure/protection-rule.repository';
import { ProtectionWorkspacePurger } from './infrastructure/purge/protection-workspace.purger';
import { ProtectionRulesController } from './http/controllers/protection-rules.controller';
import { PublishProtectionGuard } from './infrastructure/publish-protection.guard';
import { EntryPublishedSubscriber } from './infrastructure/entry-published.subscriber';
import { ReviewStatusQuery } from './application/review-status.query';
import { ReviewStatusController } from './http/controllers/review-status.controller';
import { ReviewStateFilterProvider } from './infrastructure/review-state-filter.provider';
import { ProtectionInsightsQuery } from './application/protection-insights.query';
import { ProtectionInsightsController } from './http/controllers/protection-insights.controller';
import { ProtectionToolProvider } from './tools/protection-tool.provider';

/**
 * The protection plugin's module — three tables, one controller.
 *
 * Global, so the rule lookup is injectable from where the publish path is
 * actually guarded: `PublishProtectionGuard` runs inside content's write
 * transaction, not from a route of this package's own.
 *
 * Registered **after** `ContentPlugin`, whose registry and grant query it reads
 * to decide which types a workspace may write a rule for.
 *
 * `forRoot()` takes nothing. The rule table is the whole configuration surface
 * and its empty state is the off state — a plugin that had to be switched on
 * twice, once by the operator and once per workspace, is the settings screen
 * ADR-0009 deleted.
 */
@Module({})
export class ProtectionModule {
    /** Creates the global dynamic module. */
    static forRoot(): DynamicModule {
        return {
            module: ProtectionModule,
            global: true,
            controllers: [
                ProtectionRulesController,
                // Order matters to Nest's router: `protection/queue` is a
                // literal path, and `protection/entries/:type/:id` cannot
                // shadow it — but registering the specific one first keeps that
                // true if either prefix is ever widened.
                ReviewQueueController,
                // Also a literal beneath `protection/entries/:typeName`, so it
                // is registered ahead of the `:id` routes for the same reason.
                ReviewStatusController,
                EntryReviewController,
                NewEntryProtectionController,
                ProtectionInsightsController
            ],
            providers: [
                ProtectionRulesService,
                ProtectionRuleRepository,
                EntryReviewService,
                ReviewQueueService,
                ReviewRequestRepository,
                ReviewApprovalRepository,
                // Asks content which revision is currently the head. Reading
                // `content_entry_revisions` directly would tie this package to
                // a table it does not own and cannot migrate.
                HeadRevisionQuery,
                // Who may be asked to review — one list for the picker and for
                // the check the request route makes.
                ReviewerCandidatesQuery,
                // Clears this workspace's rules, requests and approvals on
                // delete. All three carry a plain `workspace_id` with no FK, so
                // without this they outlive the workspace — the exact residue a
                // live stand found in four other tables.
                ProtectionWorkspacePurger,
                // The third gate. Registering it is what makes every rule in
                // this package mean anything — and the registrar's optional
                // injection is why a deployment without `ContentPlugin` boots
                // instead of failing on a dependency it cannot influence.
                PublishProtectionGuard,
                contentPublishGuardRegistrar(
                    'protection',
                    PublishProtectionGuard
                ),
                // Closes an open review request when the entry it was about
                // actually goes out, however it was published.
                EntryPublishedSubscriber,
                // The records column's batched read, and the aggregate behind
                // the Insights card. Both go through the kernel's counting, so
                // a cell, a card and the publish gate cannot disagree.
                ReviewStatusQuery,
                ProtectionInsightsQuery,
                // `reviewState` in the records list's own filter tree — which
                // is what makes saved views and alarms' "Save as rule" work
                // over review state with no code of their own.
                ReviewStateFilterProvider,
                entryFilterProviderRegistrar(
                    'protection',
                    ReviewStateFilterProvider
                ),
                // Three tools; there is deliberately no fourth. See the
                // provider's header and ADR-0017 §6.
                ProtectionToolProvider
            ],
            exports: [
                ProtectionRulesService,
                ProtectionRuleRepository,
                EntryReviewService,
                ReviewRequestRepository,
                ReviewApprovalRepository,
                HeadRevisionQuery,
                PublishProtectionGuard,
                ReviewStatusQuery
            ]
        };
    }
}
