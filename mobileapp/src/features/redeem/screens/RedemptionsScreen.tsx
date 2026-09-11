import { useRouter } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Pill } from '@/components/ui';
import type { Redemption } from '@/features/redeem/api/redeem';
import { STATE_PILL, dayLabel } from '@/features/redeem/format';
import { useRedemptions } from '@/features/redeem/hooks/useRedeem';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
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
  const list = useRedemptions();

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Redemptions" paddingBottom={14} />

      {list.isPending ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={68} rounded={14} />
          ))}
        </View>
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon="wallet" title="No redemptions yet" body="Requests you send appear here." />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}
          renderItem={({ item }) => (
            <Row item={item} onOpen={() => router.push(`/redeem/${item.id}`)} />
          )}
        />
      )}
    </View>
  );
}

function Row({ item, onOpen }: { item: Redemption; onOpen: () => void }) {
  const pill = STATE_PILL[item.state];

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${formatPaise(item.amountPaise)}, ${pill.label}, ${item.code}`}
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
              {item.code} · {dayLabel(item.requestedAt)}
            </Text>
          </View>
          <Pill label={pill.label} tone={pill.tone} />
          <Icon name="chevronRight" size={16} color={palette.neutral[400]} />
        </View>
      )}
    </Pressable>
  );
}
