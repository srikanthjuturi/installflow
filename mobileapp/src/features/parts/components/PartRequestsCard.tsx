import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Pill, Text } from '@/components/ui';
import { partPill, partTrail } from '@/features/parts/partStatus';
import type { JobParts, PartRequest } from '@/features/parts/types';
import { color } from '@/theme/semantic';
import { momentLabel } from '@/utils/date';

export interface PartRequestsCardProps {
  /** The parts query has been switched on — the job has been started. */
  enabled: boolean;
  isPending: boolean;
  isError: boolean;
  data: JobParts | undefined;
  onRetry: () => void;
}

/**
 * The spare-part requests on this job, each with its state and trail.
 *
 * Net-new — not in the prototype; Task 15 PROPOSED copy. Rows are not
 * pressable: there is nothing to open, and the technician cannot cancel or edit
 * one (only the parts store rejects).
 *
 * States, mobile rule 5: pending → two skeleton rows; error → a compact retry
 * INSIDE the card so the rest of the screen stays usable; empty → NOTHING. The
 * "Need a spare part" button is the empty state's action, and a card saying
 * "no parts" on every started job would be noise.
 *
 * Part names, codes, notes and the facility's reason are data and are shown as
 * sent; only the words around them are translated.
 */
export function PartRequestsCard({
  enabled,
  isPending,
  isError,
  data,
  onRetry,
}: PartRequestsCardProps) {
  const { t } = useTranslation();

  if (!enabled) return null;
  if (!isPending && !isError && (data?.requests.length ?? 0) === 0) return null;

  return (
    <View
      style={{
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 11,
          letterSpacing: 0.88,
          textTransform: 'uppercase',
          color: color.textFootnote,
          marginBottom: 10,
        }}
      >
        {t('parts.card.title')}
      </Text>

      {isError ? (
        <ErrorState compact body={t('parts.loadFailed')} onRetry={onRetry} />
      ) : isPending ? (
        <View style={{ gap: 12 }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="85%" height={12} />
        </View>
      ) : (
        <View style={{ gap: 16 }}>
          {(data?.requests ?? []).map((request, i) => (
            <RequestRow key={request.id} request={request} first={i === 0} />
          ))}
        </View>
      )}
    </View>
  );
}

function RequestRow({ request, first }: { request: PartRequest; first: boolean }) {
  const { t } = useTranslation();
  const pill = partPill(request.status, request.rejectedAfterApproval);

  return (
    <View
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.border,
        paddingTop: first ? 0 : 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Roboto_700Bold',
            fontSize: 14.5,
            color: color.textPrimary,
          }}
        >
          {request.partName}
        </Text>
        {request.isOther ? <Pill label={t('parts.card.other')} tone="neutral" /> : null}
        <Pill label={t(pill.label)} tone={pill.tone} />
      </View>

      <Text
        style={{
          fontFamily: 'RobotoMono_400Regular',
          fontSize: 11,
          color: color.textMuted,
          marginTop: 3,
        }}
      >
        {request.code}
      </Text>

      {request.note ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 18,
            color: color.textSecondary,
            marginTop: 6,
          }}
        >
          {`“${request.note}”`}
        </Text>
      ) : null}

      <View style={{ marginTop: 6, gap: 2 }}>
        {partTrail(request).map((line, i) => (
          <Text
            key={`${line.key}-${i}`}
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12.5,
              lineHeight: 18,
              color: color.textLabel,
            }}
          >
            {t(line.key, {
              ...line.params,
              // Dates travel as ISO and are worded here, at render, so a
              // language switch rewords what is already cached.
              ...(line.params.when !== undefined
                ? { when: line.params.when ? momentLabel(line.params.when) : '' }
                : {}),
            })}
          </Text>
        ))}
      </View>
    </View>
  );
}
