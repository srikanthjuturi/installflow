import { Image } from 'expo-image';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, DetailRow, Pill, QrCode, Text } from '@/components/ui';
import type { RedemptionDetail, RedemptionEvent } from '@/features/redeem/api/redeem';
import { STATE_PILL } from '@/features/redeem/format';
import {
  useConfirmRedemption,
  useRedeemable,
  useRedemption,
} from '@/features/redeem/hooks/useRedeem';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { errorText } from '@/i18n/errorText';
import { roleLabel } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';
import { momentLabel } from '@/utils/date';
import { formatPaise } from '@/utils/money';

const CARD = {
  backgroundColor: color.surfaceRaised,
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: 16,
  padding: 18,
} as const;

/**
 * One redemption, from the technician's side.
 *
 * Three moments, one screen:
 *
 *   * **waiting** — the QR, drawn here from the server's string, so a payer
 *     standing beside them can scan this phone. The payer has their own copy
 *     in the console; this one is for the person in the room.
 *   * **paid — confirm** — the payer says it went. Their screenshot and UTR
 *     are here to check the bank app against, and the two buttons are the
 *     technician's word: "I received it" is the ONLY thing in the product that
 *     makes a redemption paid, and "Not yet" tells the payer without undoing
 *     anything. The QR is gone by now — still on screen it would be an
 *     invitation to pay twice.
 *   * **received / declined** — what happened, and when.
 *
 * Net-new; the prototype has no redeem screen. Copy approved with the plan on
 * 2026-09-11.
 */
export function RedemptionScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const redemption = useRedemption(id);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('redeem.detail.title')} paddingBottom={14} />

      {redemption.isPending ? (
        <View style={{ padding: 16, gap: 14 }}>
          <Skeleton width="100%" height={120} rounded={16} />
          <Skeleton width="100%" height={260} rounded={16} />
        </View>
      ) : redemption.isError ? (
        <ErrorState onRetry={() => redemption.refetch()} />
      ) : (
        <Body data={redemption.data} refresh={redemption.refetch} />
      )}
    </View>
  );
}

function Body({
  data,
  refresh,
}: {
  data: RedemptionDetail;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  // The server's English role name ("National Head"), in the app's language.
  const payerLabel = useRedeemable().data?.payerLabel;
  const payer = payerLabel ? roleLabel(payerLabel) : undefined;
  const confirm = useConfirmRedemption(data.id);
  const pill = STATE_PILL[data.state];
  const awaiting = data.state === 'awaiting';
  // "I received it" is the last thing here — it must clear the ◁ ○ □ bar.
  const navInset = useButtonNavInset();
  // The screen a technician watches for the payer's "I paid".
  const pull = usePullToRefresh(refresh);

  return (
    <ScrollView
      refreshControl={<RefreshControl {...pull} />}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 + navInset, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={CARD}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pill label={t(pill.label)} tone={pill.tone} />
          <Text
            style={{ fontFamily: 'Roboto_500Medium', fontSize: 12, color: color.textMuted }}
          >
            {data.code}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 32,
            letterSpacing: -0.6,
            color: color.textPrimary,
            marginTop: 10,
          }}
        >
          {formatPaise(data.amountPaise)}
        </Text>
      </View>

      {data.upiUri ? (
        <View style={[CARD, { alignItems: 'center' }]}>
          {/* White plate, always — see `color.qrPlate`. */}
          <View
            style={{
              backgroundColor: color.qrPlate,
              padding: 10,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: color.border,
            }}
          >
            <QrCode
              value={data.upiUri}
              size={220}
              accessibilityLabel={t('redeem.detail.qr', {
                amount: formatPaise(data.amountPaise),
                upiId: data.upiId,
              })}
            />
          </View>
          {payer ? (
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 13,
                lineHeight: 19,
                color: color.textLabel,
                textAlign: 'center',
                marginTop: 12,
              }}
            >
              {t('redeem.detail.scanToPay', { payer })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[CARD, { paddingVertical: 4 }]}>
        <DetailRow label={t('redeem.detail.upiId')} value={data.upiId} first />
        <DetailRow label={t('redeem.detail.reference')} value={data.code} />
        <DetailRow label={t('redeem.detail.requested')} value={momentLabel(data.requestedAt)} />
      </View>

      {data.state === 'to_pay' && payer ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12,
            lineHeight: 18,
            color: color.textMuted,
            marginHorizontal: 4,
          }}
        >
          {t('redeem.detail.wrongUpi', { payer })}
        </Text>
      ) : null}

      {data.claimedAt ? (
        <View style={CARD}>
          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.textPrimary }}>
            {t('redeem.detail.paidBy', {
              name: data.claimedBy ?? '—',
              when: momentLabel(data.claimedAt),
            })}
          </Text>
          {data.utr ? (
            <Text
              selectable
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 13,
                color: color.textSecondary,
                marginTop: 4,
              }}
            >
              {t('redeem.detail.utr', { utr: data.utr })}
            </Text>
          ) : null}
          {data.proofUrl ? (
            <Image
              source={{ uri: data.proofUrl }}
              contentFit="contain"
              accessibilityLabel={t('redeem.detail.screenshot')}
              style={{
                width: '100%',
                height: 340,
                marginTop: 14,
                borderRadius: 12,
                backgroundColor: color.surfaceSunken,
              }}
            />
          ) : null}

          {awaiting ? (
            <View style={{ marginTop: 16, gap: 8 }}>
              {data.deniedAt ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.textLabel,
                    marginBottom: 4,
                  }}
                >
                  {t('redeem.detail.toldNotArrived', { name: data.claimedBy ?? '—' })}
                </Text>
              ) : null}
              <Button
                label={t('redeem.detail.received')}
                loading={confirm.isPending && confirm.variables === true}
                disabled={confirm.isPending}
                onPress={() => confirm.mutate(true)}
              />
              {/* Once said, not offered again until the payer claims again —
                  the server treats a repeat as the same complaint, and a
                  button that visibly does nothing is worse than none. */}
              {data.deniedAt ? null : (
                <Button
                  label={t('redeem.detail.notYet')}
                  variant="outline"
                  loading={confirm.isPending && confirm.variables === false}
                  disabled={confirm.isPending}
                  onPress={() => confirm.mutate(false)}
                />
              )}
              {confirm.isError ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 12.5,
                    color: color.textDanger,
                    textAlign: 'center',
                  }}
                >
                  {confirm.error instanceof Error ? errorText(confirm.error, '') : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {data.declinedAt ? (
        <View style={[CARD, { backgroundColor: color.dangerSurface, borderColor: color.dangerSurfaceBorder }]}>
          <Text
            style={{
              fontFamily: 'Roboto_500Medium',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.dangerTextStrong,
            }}
          >
            {t('redeem.detail.declinedBy', {
              name: data.declinedBy ?? '—',
              reason: data.declineReason ?? '—',
            })}
          </Text>
        </View>
      ) : null}

      {data.events.length > 0 ? (
        <View style={[CARD, { paddingVertical: 4 }]}>
          {data.events.map((event, i) => (
            <DetailRow
              key={event.id}
              label={eventLabel(event, t)}
              value={momentLabel(event.at)}
              first={i === 0}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Each line of the trail, in the words the rest of the screen already uses. */
function eventLabel(event: RedemptionEvent, t: TFunction): string {
  switch (event.kind) {
    case 'requested':
      return t('redeem.detail.events.requested');
    case 'claimed':
      return t('redeem.detail.events.claimed', { name: event.actorLabel ?? '—' });
    case 'denied':
      return t('redeem.detail.events.denied');
    case 'confirmed':
      return t('redeem.detail.events.confirmed');
    case 'declined':
      return t('redeem.detail.events.declined', { name: event.actorLabel ?? '—' });
  }
}
