import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { getEarningsSummary, listTransactions } from '@/features/earnings/api/earnings';
import { qk } from '@/lib/queryKeys';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import {
  EARNINGS_PERIODS,
  type EarningsPeriod,
  type TransactionKind,
} from '@/types/domain';
import { formatPaise, formatSignedPaise } from '@/utils/money';

/** What each span is called on the control, and under the title. */
const PERIOD_LABEL: Record<EarningsPeriod, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
};

/**
 * The line under the heading. Spells the span out rather than naming it twice:
 * the control above already says "This week", so this says which week.
 */
function periodCaption(period: EarningsPeriod, now: Date): string {
  if (period === 'day') {
    return now.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
  }
  if (period === 'month') {
    return now.toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
  }
  return 'Mon–Sun';
}

/** Each ledger kind gets its own icon and tint — a penalty must never skim as a payout. */
const KIND_STYLE: Record<TransactionKind, { icon: IconName; fg: string; bg: string }> = {
  install: { icon: 'card', fg: color.statusCompleted.fg, bg: color.statusCompleted.bg },
  bonus: { icon: 'gift', fg: palette.secondary[600], bg: palette.secondary[100] },
  penalty: { icon: 'warn', fg: color.statusCancelled.fg, bg: color.statusCancelled.bg },
};

/**
 * Screen 15 — Earnings.
 *
 * The whole summary lives in the dark hero: the net figure at 38px with the
 * three components beneath it. Leading with NET, after penalties, is the
 * point — gross would be the flattering number and the wrong one in a week
 * where a late cancellation took money back out.
 */
export function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<EarningsPeriod>('week');
  const summary = useQuery({
    queryKey: qk.earningsSummary(period),
    queryFn: () => getEarningsSummary(period),
  });
  const ledger = useQuery({
    queryKey: qk.transactions(period),
    queryFn: () => listTransactions(period),
  });

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={{
            backgroundColor: color.chrome,
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: 22,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          <Text
            style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textInverse }}
          >
            Earnings
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12.5,
              color: color.textOnChrome,
              marginTop: 2,
            }}
          >
            {PERIOD_LABEL[period]} · {periodCaption(period, new Date())}
          </Text>

          <PeriodPicker value={period} onChange={setPeriod} />

          {summary.data ? (
            <>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 38,
                  letterSpacing: -0.8,
                  color: color.textInverse,
                  marginTop: 16,
                }}
              >
                {formatPaise(summary.data.netPaise)}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textOnChrome,
                }}
              >
                Net payout after penalties
              </Text>

              {/* The dash needs a reason, or it reads as a broken screen.
                  Nothing prices an install yet, so `net` and `earned` have no
                  source — and inventing one from bonuses minus penalties
                  would show a technician who cancelled once a NEGATIVE week's
                  pay for work nobody has counted.

                  New copy: the prototype never had to say this, because its
                  numbers were made up. It goes when payouts land. */}
              {summary.data.netPaise === null ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 11.5,
                    lineHeight: 16,
                    color: color.textOnChrome,
                    marginTop: 8,
                  }}
                >
                  Job payouts aren&apos;t set up yet. Bonuses and penalties
                  below are live.
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <ChromeTile
                  label="Earned"
                  value={formatPaise(summary.data.earnedPaise)}
                  tint={color.creditOnChrome}
                />
                <ChromeTile
                  label="Bonuses"
                  value={formatPaise(summary.data.bonusesPaise)}
                  tint={color.bonusOnChrome}
                />
                <ChromeTile
                  label="Penalties"
                  value={formatPaise(summary.data.penaltiesPaise)}
                  tint={color.debitOnChrome}
                />
              </View>
            </>
          ) : (
            <View style={{ marginTop: 16, gap: 10 }}>
              <Skeleton width={180} height={40} />
              <Skeleton width="100%" height={60} rounded={12} />
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 12,
              color: color.textLabel,
              marginTop: 2,
              marginHorizontal: 4,
              marginBottom: 10,
            }}
          >
            Transactions
          </Text>

          {ledger.isPending ? (
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 16,
                padding: 15,
                gap: 20,
              }}
            >
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width={60} height={14} />
                </View>
              ))}
            </View>
          ) : ledger.isError ? (
            <ErrorState onRetry={() => ledger.refetch()} />
          ) : ledger.data.length === 0 ? (
            /* The approved body read "Completed jobs will appear here." It
               cannot say that while nothing prices an install — it would
               contradict the line in the hero directly above it, and promise
               a technician that finishing work would show up here when it
               will not. New copy; the original returns with payouts. */
            <EmptyState
              icon="wallet"
              title="No transactions yet"
              body="Bonuses and penalties will appear here."
            />
          ) : (
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {ledger.data.map((txn, i) => {
                const style = KIND_STYLE[txn.kind];

                return (
                  <View
                    key={txn.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      paddingHorizontal: 15,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: palette.neutral[100],
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        backgroundColor: style.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={style.icon} size={20} color={style.fg} />
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          fontFamily: 'Roboto_700Bold',
                          fontSize: 14,
                          color: color.textPrimary,
                        }}
                        numberOfLines={1}
                      >
                        {txn.title}
                      </Text>
                      <Text
                        style={{
                          fontFamily: 'Roboto_400Regular',
                          fontSize: 11.5,
                          color: color.textMuted,
                        }}
                      >
                        {txn.subtitle}
                      </Text>
                    </View>

                    <Text
                      style={{ fontFamily: 'Roboto_900Black', fontSize: 15, color: style.fg }}
                    >
                      {formatSignedPaise(txn.amountPaise)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Day / week / month, as a segmented control on the dark hero.
 *
 * Net-new — the prototype has no period control on this screen, so the three
 * words and the shape are new and need sign-off. Segmented rather than a
 * dropdown because there are exactly three, they never grow, and a technician
 * comparing "today" against "this week" should be able to do it with one
 * thumb rather than two taps and a sheet.
 *
 * `accessibilityRole="tab"` with `selected` carries the state, so the fill is
 * never the only thing saying which is chosen.
 */
function PeriodPicker({
  value,
  onChange,
}: {
  value: EarningsPeriod;
  onChange: (next: EarningsPeriod) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: color.chromePanel,
        borderRadius: 11,
        padding: 3,
        marginTop: 14,
        gap: 3,
      }}
    >
      {EARNINGS_PERIODS.map((option) => {
        const selected = option === value;

        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={{
              flex: 1,
              borderRadius: 9,
              paddingVertical: 8,
              alignItems: 'center',
              backgroundColor: selected ? color.surfaceRaised : 'transparent',
            }}
          >
            <Text
              // Capped: three fixed words in a row that cannot wrap without
              // pushing each other off the hero.
              maxFontSizeMultiplier={1.3}
              style={{
                fontFamily: selected ? 'Roboto_700Bold' : 'Roboto_500Medium',
                fontSize: 13,
                color: selected ? color.textPrimary : color.textOnChrome,
              }}
            >
              {PERIOD_LABEL[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChromeTile({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chromePanel,
        borderRadius: 12,
        paddingVertical: 11,
        paddingHorizontal: 13,
      }}
    >
      <Text
        style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textOnChrome }}
      >
        {label}
      </Text>
      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: tint, marginTop: 2 }}
      >
        {value}
      </Text>
    </View>
  );
}
