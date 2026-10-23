import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { Button, Text } from '@/components/ui';
import { useIsEmployee } from '@/features/profile/hooks/useIsEmployee';
import type { Redeemable } from '@/features/redeem/api/redeem';
import { useRedeemable } from '@/features/redeem/hooks/useRedeem';
import { color } from '@/theme/semantic';
import { formatPaise } from '@/utils/money';

/**
 * The way from "what I earned" to "money in my account".
 *
 * Sits on Earnings between the hero and the ledger, and deliberately says a
 * DIFFERENT number from the hero: that one is a period's net, this is
 * everything owed and not yet asked for. "Available to redeem" is the label
 * that keeps the two from being read as one figure.
 *
 * Net-new — the prototype has no redeem control. Copy approved with the plan
 * on 2026-09-11.
 */
export function RedeemCard() {
  const router = useRouter();
  const { t } = useTranslation();
  const redeemable = useRedeemable();
  // Task 06. An employee's job pay comes with their salary, so the card
  // explains itself rather than promising an amount they will not be paid.
  const employee = useIsEmployee();

  return (
    <View
      style={{
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 16,
        padding: 16,
        marginBottom: 18,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Roboto_700Bold',
            fontSize: 12,
            color: color.textLabel,
          }}
        >
          {employee && !redeemable.data?.open
            ? t('earnings.employee.title')
            : t('redeem.card.available')}
        </Text>
        <Pressable
          onPress={() => router.push('/redeem')}
          hitSlop={8}
          accessibilityRole="link"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          {({ pressed }) => (
            <>
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 12.5,
                  color: color.textLink,
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                {t('redeem.card.history')}
              </Text>
              <Icon name="chevronRight" size={14} color={color.textLink} />
            </>
          )}
        </Pressable>
      </View>

      {redeemable.isPending ? (
        <View style={{ gap: 12, marginTop: 4 }}>
          <Skeleton width={140} height={30} />
          <Skeleton width="100%" height={46} rounded={12} />
        </View>
      ) : redeemable.isError ? (
        <View style={{ marginTop: 2 }}>
          {/* The generic error sentence the app already uses — nothing here is
              specific enough to say more, and the card must not sit on a
              skeleton for ever. */}
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              lineHeight: 19,
              color: color.textSecondary,
            }}
          >
            {t('components.errorState.body')}
          </Text>
          <Pressable
            onPress={() => redeemable.refetch()}
            hitSlop={8}
            accessibilityRole="button"
            style={{ alignSelf: 'flex-start', marginTop: 10 }}
          >
            {({ pressed }) => (
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 13.5,
                  color: color.textLink,
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                {t('common.tryAgain')}
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Body data={redeemable.data} employee={employee} />
      )}
    </View>
  );
}

function Body({ data, employee }: { data: Redeemable; employee: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const open = data.open;

  // One open at a time, so while there is one the card is ABOUT it — a second
  // Redeem button would only answer "you already have one". It runs before the
  // employee branch: an employee with an open redemption (made while a
  // freelancer) must still be able to View / Confirm it.
  if (open) {
    const awaiting = open.state === 'awaiting';
    return (
      <>
        <Amount paise={open.amountPaise} />
        <Text
          style={{
            fontFamily: 'Roboto_500Medium',
            fontSize: 13,
            lineHeight: 19,
            color: awaiting ? color.textPrimary : color.textSecondary,
            marginTop: 2,
            marginBottom: 14,
          }}
        >
          {awaiting
            ? t('redeem.card.paidBy', {
                amount: formatPaise(open.amountPaise),
                name: open.claimedBy ?? '—',
              })
            : t('redeem.card.requested', { amount: formatPaise(open.amountPaise) })}
        </Text>
        <Button
          label={awaiting ? t('redeem.card.confirm') : t('redeem.card.view')}
          variant={awaiting ? 'primary' : 'secondary'}
          onPress={() => router.push(`/redeem/${open.id}`)}
        />
      </>
    );
  }

  // Task 06. No amount, no Redeem button, no Add UPI ID button — the job pay
  // lands with the salary and there is nothing to ask for here. The payout
  // account itself stays reachable from Profile → Payout account: a type can
  // change back, and UPI-change approval is Task 05's flow, unaffected.
  if (employee) {
    return (
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          lineHeight: 19,
          color: color.textSecondary,
          marginTop: 2,
        }}
      >
        {t('earnings.employee.body')}
      </Text>
    );
  }

  // Not faked to ₹0 when it is below: a technician who owes a penalty should
  // see that they do, not a zero that hides why nothing can be redeemed.
  const shown = data.redeemablePaise > 0 ? data.redeemablePaise : data.availablePaise;

  if (!data.upiId) {
    return (
      <>
        <Amount paise={shown} />
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            color: color.textSecondary,
            marginTop: 2,
            marginBottom: 14,
          }}
        >
          {t('redeem.card.addUpiPrompt')}
        </Text>
        <Button
          label={t('redeem.card.addUpi')}
          variant="secondary"
          onPress={() => router.push('/payout-account')}
        />
      </>
    );
  }

  return (
    <>
      <Amount paise={shown} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          color: color.textSecondary,
          marginTop: 2,
          marginBottom: 14,
        }}
      >
        {t('redeem.card.to', { upiId: data.upiId })}
      </Text>
      <Button
        label={t('redeem.card.redeem')}
        disabled={data.redeemablePaise <= 0}
        disabledHint={t('redeem.card.nothing')}
        onPress={() => router.push('/redeem-confirm')}
      />
    </>
  );
}

function Amount({ paise }: { paise: number }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_900Black',
        fontSize: 28,
        letterSpacing: -0.5,
        color: paise < 0 ? color.debit : color.textPrimary,
      }}
    >
      {formatPaise(paise)}
    </Text>
  );
}
