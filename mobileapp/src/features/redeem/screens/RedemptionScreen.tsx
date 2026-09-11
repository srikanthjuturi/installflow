import { Image } from 'expo-image';
import { ScrollView, Text, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, DetailRow, Pill, QrCode } from '@/components/ui';
import type { RedemptionDetail, RedemptionEvent } from '@/features/redeem/api/redeem';
import { STATE_PILL, momentLabel } from '@/features/redeem/format';
import {
  useConfirmRedemption,
  useRedeemable,
  useRedemption,
} from '@/features/redeem/hooks/useRedeem';
import { color } from '@/theme/semantic';
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
  const redemption = useRedemption(id);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Redemption" paddingBottom={14} />

      {redemption.isPending ? (
        <View style={{ padding: 16, gap: 14 }}>
          <Skeleton width="100%" height={120} rounded={16} />
          <Skeleton width="100%" height={260} rounded={16} />
        </View>
      ) : redemption.isError ? (
        <ErrorState onRetry={() => redemption.refetch()} />
      ) : (
        <Body data={redemption.data} />
      )}
    </View>
  );
}

function Body({ data }: { data: RedemptionDetail }) {
  const payer = useRedeemable().data?.payerLabel;
  const confirm = useConfirmRedemption(data.id);
  const pill = STATE_PILL[data.state];
  const awaiting = data.state === 'awaiting';

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={CARD}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pill label={pill.label} tone={pill.tone} />
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
              accessibilityLabel={`UPI QR code for ${formatPaise(data.amountPaise)} to ${data.upiId}`}
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
              Your {payer} can scan this to pay you
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[CARD, { paddingVertical: 4 }]}>
        <DetailRow label="UPI ID" value={data.upiId} first />
        <DetailRow label="Reference" value={data.code} />
        <DetailRow label="Requested" value={momentLabel(data.requestedAt)} />
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
          Wrong UPI ID? Ask your {payer} to decline this, then request again.
        </Text>
      ) : null}

      {data.claimedAt ? (
        <View style={CARD}>
          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.textPrimary }}>
            Paid by {data.claimedBy ?? '—'} · {momentLabel(data.claimedAt)}
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
              UTR {data.utr}
            </Text>
          ) : null}
          {data.proofUrl ? (
            <Image
              source={{ uri: data.proofUrl }}
              contentFit="contain"
              accessibilityLabel="Payment screenshot"
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
                  We told {data.claimedBy ?? '—'} it hasn&apos;t arrived.
                </Text>
              ) : null}
              <Button
                label="I received it"
                loading={confirm.isPending && confirm.variables === true}
                disabled={confirm.isPending}
                onPress={() => confirm.mutate(true)}
              />
              {/* Once said, not offered again until the payer claims again —
                  the server treats a repeat as the same complaint, and a
                  button that visibly does nothing is worse than none. */}
              {data.deniedAt ? null : (
                <Button
                  label="Not yet"
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
                  {confirm.error instanceof Error ? confirm.error.message : ''}
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
            Declined by {data.declinedBy ?? '—'}: {data.declineReason ?? '—'}
          </Text>
        </View>
      ) : null}

      {data.events.length > 0 ? (
        <View style={[CARD, { paddingVertical: 4 }]}>
          {data.events.map((event, i) => (
            <DetailRow
              key={event.id}
              label={eventLabel(event)}
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
function eventLabel(event: RedemptionEvent): string {
  switch (event.kind) {
    case 'requested':
      return 'Requested';
    case 'claimed':
      return `Paid by ${event.actorLabel ?? '—'}`;
    case 'denied':
      return 'Not yet';
    case 'confirmed':
      return 'Received';
    case 'declined':
      return `Declined by ${event.actorLabel ?? '—'}`;
  }
}
