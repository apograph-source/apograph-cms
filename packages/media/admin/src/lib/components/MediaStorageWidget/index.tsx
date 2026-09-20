import { defineMessages, useIntl } from 'react-intl';
import {
    BarRows,
    WidgetCard,
    type BarRowSpec,
    type ChartTone
} from '@orthacms/insights-admin';
import { useMediaStorage } from '../../hooks/useMediaInsights';
import { formatBytes } from '../../utils/formatBytes';

/** Intl descriptors for the storage widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'media.insights.storageBreakdown.title',
        defaultMessage: "What's using the storage"
    },
    description: {
        id: 'media.insights.storageBreakdown.description',
        defaultMessage: '{bytes} across {count, number} assets'
    },
    tip: {
        id: 'media.insights.storageBreakdown.tip',
        defaultMessage: '{kind} — {bytes} across {count, number} assets'
    },
    footer: {
        id: 'media.insights.storageBreakdown.footer',
        defaultMessage:
            '{kind} is {countShare}% of the assets and {byteShare}% of the storage.'
    },
    image: { id: 'media.insights.kind.image', defaultMessage: 'Image' },
    video: { id: 'media.insights.kind.video', defaultMessage: 'Video' },
    audio: { id: 'media.insights.kind.audio', defaultMessage: 'Audio' },
    document: {
        id: 'media.insights.kind.document',
        defaultMessage: 'Document'
    },
    archive: { id: 'media.insights.kind.archive', defaultMessage: 'Archive' }
});

/**
 * Ramp steps by rank, deepest first.
 *
 * Here the ramp genuinely does encode magnitude — the rows arrive sorted by
 * bytes — so colour and length say the same thing. That is the one case where
 * ranking the ramp is correct rather than misleading.
 */
const RANK_TONES: ChartTone[] = ['q5', 'q4', 'q3', 'q2', 'q1'];

/** Falls back to the raw kind if the server ever adds one the UI doesn't know. */
function kindLabel(kind: string, intl: ReturnType<typeof useIntl>): string {
    const descriptor = messages[kind as keyof typeof messages];
    return descriptor ? intl.formatMessage(descriptor) : kind;
}

/**
 * Storage by media kind, measured in **bytes**.
 *
 * Bars are bytes and only bytes. An earlier draft scaled the bar by asset count
 * while the readout showed size, which put two different measures on one row and
 * made the widget's whole point — that a few videos outweigh thousands of images
 * — impossible to see.
 */
export function MediaStorageWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useMediaStorage();

    const kinds = data?.kinds ?? [];
    const max = Math.max(...kinds.map((kind) => kind.bytes), 0);

    const rows: BarRowSpec[] = kinds.map((kind, index) => {
        const label = kindLabel(kind.kind, intl);
        return {
            id: kind.kind,
            label,
            segments: [
                {
                    id: kind.kind,
                    value: kind.bytes,
                    tone: RANK_TONES[index] ?? 'q1',
                    label: intl.formatMessage(messages.tip, {
                        kind: label,
                        bytes: formatBytes(kind.bytes),
                        count: kind.count
                    })
                }
            ],
            readout: formatBytes(kind.bytes)
        };
    });

    // The heaviest kind is the one worth calling out, and it is first because
    // the server sorts by bytes.
    const heaviest = kinds[0];
    const footer =
        heaviest && data && data.totalBytes > 0 && data.totalCount > 0
            ? intl.formatMessage(messages.footer, {
                  kind: kindLabel(heaviest.kind, intl),
                  countShare: Math.round(
                      (heaviest.count / data.totalCount) * 100
                  ),
                  byteShare: Math.round(
                      (heaviest.bytes / data.totalBytes) * 100
                  )
              })
            : undefined;

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description, {
                bytes: formatBytes(data?.totalBytes ?? 0),
                count: data?.totalCount ?? 0
            })}
            footer={footer}
            isPending={isPending}
            isError={isError}
            isEmpty={kinds.length === 0}
            skeletonRows={5}
        >
            <BarRows rows={rows} max={max} />
        </WidgetCard>
    );
}
