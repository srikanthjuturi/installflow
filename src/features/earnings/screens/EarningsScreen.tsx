import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Card } from '@/components/ui';
import { getEarningsSummary, listTransactions } from '@/features/earnings/api/earnings';
import { qk } from '@/lib/queryKeys';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { TransactionKind } from '@/types/domain';
import { formatPaise, formatSignedPaise } from '@/utils/money';

/** Each ledger kind gets its own icon and colour — a penalty must never look like a payout. */
const KIND_STYLE: Record<TransactionKind, { icon: IconName; fg: string; bg: string }> = {
  install: { icon: 'card', fg: color.statusCompleted.fg, bg: color.statusCompleted.bg },
  bonus: { icon: 'gift', fg: color.slotFg, bg: color.slotBg },
  penalty: { icon: 'warn', fg: color.statusCancelled.fg, bg: color.statusCancelled.bg },
};

/**
 * Screen 15 — Earnings.
 *
 * Leads with NET, after penalties. Showing gross first would be the flattering
 * number and the wrong one: a technician needs to know what actually lands,
 * especially in a week where a late cancellation took 250 off it.
 */
export function EarningsScreen() {
  const summary = useQuery({ queryKey: qk.earningsSummary(), queryFn: getEarningsSummary });
  const ledger = useQuery({ queryKey: qk.transactions(), queryFn: listTransactions });

  return (
    <>
      <Header title="Earnings" showBack={false} />

      <Screen>
        <Card style={{ paddingVertical: 22, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 11,
              letterSpacing: 1.4,
              color: color.textMuted,
            }}
          >
            THIS WEEK · MON–SUN
          </Text>

          {summary.isPending ? (
            <View style={{ marginTop: 10 }}>
              <Skeleton width={160} height={40} />
            </View>
          ) : summary.isError ? (
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 14,
                color: color.textMuted,
                marginTop: 12,
              }}
            >
              Couldn&apos;t load
            </Text>
          ) : (
            <>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 40,
                  color: color.textPrimary,
                  marginTop: 6,
                  letterSpacing: -1,
                }}
              >
                {formatPaise(summary.data.netPaise)}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textSecondary,
                  marginTop: 2,
                }}
              >
                Net payout after penalties
              </Text>
            </>
          )}
        </Card>

        {summary.data ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <StatTile label="Earned" value={formatPaise(summary.data.earnedPaise)} />
            <StatTile
              label="Bonuses"
              value={formatPaise(summary.data.bonusesPaise)}
              tint={color.bonus}
            />
            <StatTile
              label="Penalties"
              value={formatPaise(summary.data.penaltiesPaise)}
              tint={color.debit}
            />
          </View>
        ) : null}

        <Text
          style={{
            fontFamily: 'Roboto_700Bold',
            fontSize: 11,
            letterSpacing: 1.4,
            color: color.textSecondary,
            marginTop: 28,
            marginBottom: 10,
          }}
        >
          TRANSACTIONS
        </Text>

        {ledger.isPending ? (
          <Card>
            <View style={{ gap: 20 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width={60} height={14} />
                </View>
              ))}
            </View>
          </Card>
        ) : ledger.isError ? (
          <ErrorState onRetry={() => ledger.refetch()} />
        ) : ledger.data.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="No transactions yet"
            body="Completed jobs will appear here."
          />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {ledger.data.map((txn, i) => {
              const style = KIND_STYLE[txn.kind];

              return (
                <View
                  key={txn.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 13,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: color.border,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.full,
                      backgroundColor: style.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={style.icon} size={17} color={style.fg} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: 'Roboto_500Medium',
                        fontSize: 13.5,
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
                        marginTop: 1,
                      }}
                    >
                      {txn.subtitle}
                    </Text>
                  </View>

                  <Text
                    style={{ fontFamily: 'Roboto_900Black', fontSize: 14, color: style.fg }}
                  >
                    {formatSignedPaise(txn.amountPaise)}
                  </Text>
                </View>
              );
            })}
          </Card>
        )}
      </Screen>
    </>
  );
}

function StatTile({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: radius.md,
        padding: 12,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 11.5, color: color.textMuted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: 16,
          color: tint ?? color.textPrimary,
          marginTop: 3,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
