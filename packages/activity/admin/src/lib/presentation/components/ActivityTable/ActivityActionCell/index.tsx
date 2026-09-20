import { useIntl } from 'react-intl';
import { Badge } from '@orthacms/design-system';
import type { ActivityKind } from '../../../../types/activityKinds';
import { formatActivityAction } from '../../../activityMessages';

/**
 * The "Action" cell: the localized, human-readable label for an event kind,
 * rendered as a subtle badge. The label comes from the shared
 * {@link formatActivityAction} renderer, never a hardcoded string.
 */
export function ActivityActionCell({ kind }: { kind: ActivityKind }) {
    const intl = useIntl();
    return (
        <Badge variant="secondary" className="rounded-xl border-border">
            {formatActivityAction(intl, kind)}
        </Badge>
    );
}
