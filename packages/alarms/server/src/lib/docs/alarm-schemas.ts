/**
 * The OpenAPI schemas the alarms plugin contributes.
 *
 * Its response views are TypeScript `interface`s — erased before
 * `@nestjs/swagger` runs — so the scanner emits an empty `200` for every route.
 * These are the same shapes as plain schema objects, attached to the finished
 * document by {@link describeAlarmsApi}.
 *
 * The vocabularies are imported rather than restated: the severities and states
 * come from this package's own domain, and the filter operators from the parser
 * that actually validates a stored tree. An enum in the reference that has
 * drifted from the one the server enforces is worse than a bare string.
 */

import { FilterOperator, WithinLastUnit } from '@orthacms/utils-server';
import { ALARM_SEVERITIES } from '../domain/alarm-severity';
import { FINDING_STATES } from '../domain/finding-state';

/** A JSON Schema fragment, as it appears in the OpenAPI document. */
export type OpenApiSchema = Record<string, unknown>;

/** `#/components/schemas/<name>`. */
export function ref(name: string): OpenApiSchema {
    return { $ref: `#/components/schemas/${name}` };
}

const UUID: OpenApiSchema = { type: 'string', format: 'uuid' };
const DATE_TIME: OpenApiSchema = { type: 'string', format: 'date-time' };

/** Severity, from the domain. It orders and colours; it never gates. */
const SEVERITY: OpenApiSchema = {
    type: 'string',
    enum: [...ALARM_SEVERITIES],
    description:
        'How loudly the rule speaks. Carries no authority — no severity blocks a save or a publish (ADR-0015).'
};

/** Finding state, from the domain. */
const STATE: OpenApiSchema = {
    type: 'string',
    enum: [...FINDING_STATES],
    description:
        'A resolved finding keeps its `firstSeenAt`, so an entry that starts matching again is the same finding rather than a new one.'
};

/**
 * One leaf of the stored filter tree.
 *
 * The operator list is the parser's, `within_last` included — and that one is
 * the reason a stored filter is not the same object as a shared deep link. The
 * admin resolves `within_last` into a concrete cutoff when it serialises a URL
 * (a shared link should keep showing the same rows); an alarm rule keeps the
 * operator, because "not updated in 90 days" has to go on meaning that.
 */
const FILTER_RULE: OpenApiSchema = {
    type: 'object',
    title: 'AlarmFilterRule',
    description: 'A leaf comparison: a field path, an operator, and a value.',
    required: ['field', 'op'],
    properties: {
        field: {
            type: 'string',
            description:
                'A dotted path from the content type’s filterable fields, e.g. `status` or `author.name`. An unknown path is a rejected rule, not a query.',
            example: 'author.status'
        },
        op: {
            type: 'string',
            enum: Object.values(FilterOperator),
            description:
                'The pattern family (`like`/`ilike`/`nilike`) is text-only and is refused on a date, number, boolean or uuid field.'
        },
        value: {
            description:
                'The comparison value: a scalar for most operators, an array for `in`/`nin`, a boolean for `null` (true = IS NULL), and `{ n, unit }` for `within_last`.',
            anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' },
                { type: 'array', items: {} },
                {
                    type: 'object',
                    title: 'WithinLastWindow',
                    required: ['n', 'unit'],
                    properties: {
                        n: { type: 'integer', minimum: 1 },
                        unit: {
                            type: 'string',
                            enum: Object.values(WithinLastUnit)
                        }
                    }
                }
            ]
        }
    }
};

/**
 * A group node: `{ and: [...] }` or `{ or: [...] }`, whose children are nodes
 * again.
 *
 * Both keys are listed as optional properties rather than as two `oneOf`
 * branches because the parser's rule is "exactly one of them is **present**",
 * which JSON Schema can only say with `minProperties`/`maxProperties` — and
 * saying it that way keeps the recursion readable. A group carrying both is
 * rejected by the server, and the description says so.
 */
const FILTER_GROUP: OpenApiSchema = {
    type: 'object',
    title: 'AlarmFilterGroup',
    description:
        'Combines child nodes. Exactly one of `and` / `or` may be present; a group declaring both is refused.',
    minProperties: 1,
    maxProperties: 1,
    properties: {
        and: { type: 'array', items: ref('AlarmFilterNode') },
        or: { type: 'array', items: ref('AlarmFilterNode') }
    }
};

/**
 * The recursive node — the whole point of describing this by name.
 *
 * The tree is stored **verbatim**, exactly as the records list serialises it,
 * and it nests: groups holding rules and groups. Flattening it to "an object"
 * would leave a client author guessing at the one thing they need to write.
 *
 * `anyOf`, not `oneOf`: `oneOf` means *exactly one*, and the two alternatives
 * are not disjoint — `{}` and any object carrying both an `and` and a `field`
 * would match neither branch cleanly, turning a schema that describes the
 * grammar into one that rejects the parser's own inputs.
 */
const FILTER_NODE: OpenApiSchema = {
    title: 'AlarmFilterNode',
    description:
        'One node of the filter tree: a group (`{"and":[…]}` / `{"or":[…]}`) or a rule (`{"field":…,"op":…,"value":…}`). Nests to the depth the parser allows (5 group levels, 50 nodes by default).',
    anyOf: [ref('AlarmFilterGroup'), ref('AlarmFilterRule')]
};

/** A rule as every read returns it. */
const RULE: OpenApiSchema = {
    type: 'object',
    description:
        'One workspace rule. It flags content; it never blocks a write (ADR-0015).',
    required: [
        'id',
        'contentType',
        'name',
        'findingTitle',
        'description',
        'severity',
        'filter',
        'enabled',
        'brokenReason',
        'lastScanAt',
        'createdAt',
        'updatedAt',
        'openCount'
    ],
    properties: {
        id: UUID,
        contentType: {
            type: 'string',
            description:
                'The content type this rule watches. It cannot be changed — a rule that watched something else would make every finding it holds meaningless.'
        },
        name: {
            type: 'string',
            description:
                'How the rule is named in the list. Unique per workspace.'
        },
        findingTitle: {
            type: 'string',
            description: 'What a finding of this rule says in the entry editor.'
        },
        description: { type: 'string', nullable: true },
        severity: SEVERITY,
        // The tree the records list serialised, stored verbatim. A bare
        // `$ref`: OpenAPI 3.0 ignores keywords written beside one, so what it
        // means is said on the node schema itself.
        filter: ref('AlarmFilterNode'),
        enabled: {
            type: 'boolean',
            description:
                'A disabled rule stops evaluating but keeps its findings.'
        },
        brokenReason: {
            type: 'string',
            nullable: true,
            description:
                'Set when the stored filter no longer parses against its content type — e.g. a field it names was removed.'
        },
        lastScanAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: DATE_TIME,
        updatedAt: DATE_TIME,
        openCount: {
            type: 'integer',
            description: 'Findings of this rule currently open.'
        }
    }
};

/** One finding, joined to the rule that produced it. */
const FINDING: OpenApiSchema = {
    type: 'object',
    description: 'One (rule, entry) pair the rule currently matches — or did.',
    required: [
        'ruleId',
        'ruleName',
        'title',
        'contentType',
        'entryId',
        'severity',
        'state',
        'detail',
        'firstSeenAt',
        'lastSeenAt'
    ],
    properties: {
        ruleId: UUID,
        ruleName: { type: 'string' },
        title: {
            type: 'string',
            description: 'The rule’s `findingTitle` — what the editor reads.'
        },
        contentType: { type: 'string' },
        entryId: UUID,
        severity: SEVERITY,
        state: STATE,
        detail: {
            nullable: true,
            description:
                'Free-form JSON an evaluator may attach. Nothing writes one today, so it is null in practice.'
        },
        firstSeenAt: DATE_TIME,
        lastSeenAt: DATE_TIME
    }
};

/**
 * One page of findings.
 *
 * Note what is **not** here: a `pageCount`. This page envelope carries four
 * fields, unlike the delivery log's five, and a client that assumes one shape
 * across the API divides by undefined.
 */
const FINDING_PAGE: OpenApiSchema = {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize'],
    properties: {
        items: { type: 'array', items: ref('AlarmFinding') },
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' }
    }
};

/** Open findings for a batch of entries, keyed by entry id. */
const FINDINGS_BY_ENTRY: OpenApiSchema = {
    type: 'object',
    description:
        'One request per page of records rather than one per row. An entry with no open findings is absent from the map rather than present with an empty array.',
    required: ['byEntry'],
    properties: {
        byEntry: {
            type: 'object',
            additionalProperties: {
                type: 'array',
                items: ref('AlarmFinding')
            }
        }
    }
};

/** The counts behind the nav badge and the dashboard panel. */
const SUMMARY: OpenApiSchema = {
    type: 'object',
    required: ['open', 'openTotal'],
    properties: {
        open: {
            type: 'object',
            description:
                'Open findings per severity. Every severity is present, at zero when there are none.',
            required: [...ALARM_SEVERITIES],
            properties: Object.fromEntries(
                ALARM_SEVERITIES.map((severity) => [
                    severity,
                    { type: 'integer' }
                ])
            )
        },
        openTotal: { type: 'integer' }
    }
};

/** What one scan did. */
const SCAN_RESULT: OpenApiSchema = {
    type: 'object',
    description:
        'The outcome of a scan, so "Check now" can say something more useful than "done".',
    required: ['ruleId', 'scanned', 'opened', 'resolved', 'open'],
    properties: {
        ruleId: UUID,
        scanned: { type: 'integer', description: 'Entries examined.' },
        opened: {
            type: 'integer',
            description: 'Findings that were not open before and are now.'
        },
        resolved: {
            type: 'integer',
            description: 'Findings that stopped matching and were closed.'
        },
        open: {
            type: 'integer',
            description: 'Total open findings for this rule after the scan.'
        }
    }
};

/** Create answers with the rule *and* the scan it ran straight away. */
const RULE_CREATED: OpenApiSchema = {
    type: 'object',
    description:
        'The stored rule and the full scan run on creation — so a new rule reports on the content that already exists, not only on what is edited afterwards.',
    required: ['rule', 'scan'],
    properties: {
        rule: ref('AlarmRule'),
        scan: ref('AlarmScanResult')
    }
};

/** The rule editor's live readout. */
const RULE_PREVIEW: OpenApiSchema = {
    type: 'object',
    description:
        'How many entries a candidate filter matches, out of how many the workspace holds. The denominator is what turns a number into a judgement about whether the rule is too broad.',
    required: ['matched', 'total', 'sampleIds'],
    properties: {
        matched: { type: 'integer' },
        total: { type: 'integer' },
        sampleIds: {
            type: 'array',
            items: UUID,
            description: 'The first few matching entry ids.'
        }
    }
};

/** Every schema this plugin adds, keyed by component name. */
export function buildAlarmSchemas(): Record<string, OpenApiSchema> {
    return {
        AlarmFilterNode: FILTER_NODE,
        AlarmFilterGroup: FILTER_GROUP,
        AlarmFilterRule: FILTER_RULE,
        AlarmRule: RULE,
        AlarmRuleCreated: RULE_CREATED,
        AlarmRulePreview: RULE_PREVIEW,
        AlarmScanResult: SCAN_RESULT,
        AlarmFinding: FINDING,
        AlarmFindingPage: FINDING_PAGE,
        AlarmFindingsByEntry: FINDINGS_BY_ENTRY,
        AlarmSummary: SUMMARY
    };
}
