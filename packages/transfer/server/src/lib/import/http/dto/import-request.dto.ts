import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
    CONFLICT_POLICIES,
    CONFLICT_POLICY,
    RELATION_POLICIES,
    RELATION_POLICY,
    type ConflictPolicy,
    type RelationPolicy
} from '@orthacms/transfer-domain';

/**
 * Body for the import routes, alongside the uploaded file.
 *
 * Multipart, so every field arrives as a string — hence no `@IsBoolean()`
 * anywhere here. The two real settings are the conflict policy and the relation
 * policy, and they are two rather than one because they govern different halves
 * of the document: the records the caller selected, and the records those point
 * at.
 */
export class ImportRequestDto {
    @ApiPropertyOptional({
        enum: CONFLICT_POLICIES,
        default: CONFLICT_POLICY.Skip,
        description:
            'What to do when an incoming record the caller selected matches one that already exists. `skip` (the default) cannot lose data; `update` overwrites; `duplicate` writes a second row; `fail` refuses the whole run on the first match. Related (depth-1) records are governed by `relations` instead.'
    })
    @IsOptional()
    @IsIn(CONFLICT_POLICIES)
    policy?: ConflictPolicy;

    @ApiPropertyOptional({
        enum: RELATION_POLICIES,
        default: RELATION_POLICY.Link,
        description:
            'What to do with the related records the document carries — the ones pulled in because a selected record points at them. `link` (the default) matches them to what is already here and links to it, creating only what nothing matched; `update` links and overwrites their values; `recreate` never matches, writing a fresh row for each and pointing the links at those.'
    })
    @IsOptional()
    @IsIn(RELATION_POLICIES)
    relations?: RelationPolicy;
}
