import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Pill, Text } from '@/components/ui';
import type { Redemption } from '@/features/redeem/api/redeem';
import { STATE_PILL } from '@/features/redeem/format';
import { useRedemptions } from '@/features/redeem/hooks/useRedeem';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import { dayMonthLabel } from '@/utils/date';
import { formatPaise } from '@/utils/money';

/**
 * Every redemption this technician has asked for, newest first.
 *
 * The answer to "when did I get paid, and how much" — which the Earnings
 * ledger deliberately cannot give, because a redemption is not a ledger row.
 *
 * Net-new; copy approved with the plan on 2026-09-11.
 */
export function RedemptionsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const list = useRedemptions();
  // Room for the ◁ ○ □ bar, so the last row clears it — see the hook.
  const navInset = useButtonNavInset();
  // Waiting on somebody else — the payer marking a request paid.
  const pull = usePullToRefresh(list.refetch);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('redeem.history.title')} paddingBottom={14} />

      {list.isPending ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={68} rounded={14} />
          ))}
        </View>
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon="wallet"
          title={t('redeem.history.emptyTitle')}
          body={t('redeem.history.emptyBody')}
        />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + navInset, gap: 10 }}
          refreshControl={<RefreshControl {...pull} />}
          renderItem={({ item }) => (
            <Row item={item} onOpen={() => router.push(`/redeem/${item.id}`)} />
          )}
        />
      )}
    </View>
  );
}

function Row({ item, onOpen }: { item: Redemption; onOpen: () => void }) {
  const { t } = useTranslation();
  const pill = STATE_PILL[item.state];

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${formatPaise(item.amountPaise)}, ${t(pill.label)}, ${item.code}`}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: pressed ? palette.neutral[50] : color.surfaceRaised,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 15,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: color.textPrimary }}
            >
              {formatPaise(item.amountPaise)}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 11.5,
                color: color.textMuted,
                marginTop: 2,
              }}
            >
              {item.code} · {dayMonthLabel(item.requestedAt)}
            </Text>
          </View>
          <Pill label={t(pill.label)} tone={pill.tone} />
          <Icon name="chevronRight" size={16} color={palette.neutral[400]} />
        </View>
      )}
    </Pressable>
  );
}
