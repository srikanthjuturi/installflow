import { useRouter } from 'expo-router';
import { Trans, useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Button, Sheet, Text } from '@/components/ui';
import { isRedeemRefused } from '@/features/redeem/api/redeem';
import { useRedeemable, useRequestRedemption } from '@/features/redeem/hooks/useRedeem';
import { errorText } from '@/i18n/errorText';
import { roleLabel } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';
import { formatPaise } from '@/utils/money';

/**
 * "Redeem ₹4,250?" — the one deliberate tap between a balance and a request.
 *
 * A second step rather than a one-tap redeem, for the reason accept has one:
 * this puts the technician's UPI ID in front of their payer, and the moment to
 * notice it is wrong is before it is somebody else's job to pay it.
 *
 * The figure comes from the server's balance and is sent back as proof of what
 * was shown. If it moved in between, the request is refused with the new one,
 * the balance refetches, and the heading updates under the technician's thumb
 * — the next tap sends the figure they are now looking at.
 *
 * Net-new; copy approved with the plan on 2026-09-11.
 */
export function RedeemConfirmSheet() {
  const router = useRouter();
  const { t } = useTranslation();
  const redeemable = useRedeemable();
  const request = useRequestRedemption();

  const dismiss = () => router.back();
  const data = redeemable.data;
  const amount = data?.redeemablePaise ?? 0;

  const refusal = isRedeemRefused(request.error) ? request.error : null;
  // A changed balance is the one refusal the next tap fixes. The others — no
  // UPI ID, nothing left, one already open — reproduce on every tap, so the
  // button that would send it again goes rather than doing nothing twice.
  const final = refusal !== null && refusal.code !== 'BALANCE_CHANGED';

  return (
    <Sheet onDismiss={dismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            backgroundColor: color.statusCompleted.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="wallet" size={26} color={color.statusCompleted.fg} />
        </View>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Roboto_900Black',
            fontSize: 20,
            color: color.textPrimary,
          }}
        >
          {t('redeem.confirm.title', { amount: formatPaise(amount) })}
        </Text>
      </View>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 22,
          color: color.textLabel,
          marginBottom: 16,
        }}
      >
        <Trans
          i18nKey="redeem.confirm.body"
          values={{
            upiId: data?.upiId ?? '—',
            payer: data?.payerLabel ? roleLabel(data.payerLabel) : '—',
          }}
          components={{
            bold: <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }} />,
          }}
        />
      </Text>

      {request.isError ? (
        <Text
          style={{
            fontFamily: 'Roboto_500Medium',
            fontSize: 13,
            lineHeight: 19,
            color: color.textDanger,
            marginBottom: 16,
          }}
        >
          {/* The server's own sentence — for BALANCE_CHANGED it names the new
              figure ("Your balance changed to ₹4,100."), and for the rest it
              says exactly what is in the way. */}
          {request.error instanceof Error ? errorText(request.error, '') : ''}
        </Text>
      ) : null}

      {final ? (
        refusal?.code === 'NO_UPI_ID' ? (
          <Button
            label={t('redeem.card.addUpi')}
            onPress={() => router.replace('/payout-account')}
          />
        ) : (
          <Button label={t('common.close')} onPress={dismiss} />
        )
      ) : (
        <Button
          label={t('redeem.confirm.send')}
          loading={request.isPending}
          disabled={!data || amount <= 0 || redeemable.isFetching}
          onPress={() =>
            request.mutate(amount, {
              // Replace the sheet with the redemption, so Back from it returns
              // to Earnings rather than to a sheet asking the same question.
              onSuccess: (detail) => router.replace(`/redeem/${detail.id}`),
            })
          }
        />
      )}
      {final ? null : (
        <View style={{ marginTop: 6 }}>
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={dismiss}
            disabled={request.isPending}
          />
        </View>
      )}
    </Sheet>
  );
}
