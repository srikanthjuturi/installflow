import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Button, Switch } from '@/components/ui';
import { qk } from '@/lib/queryKeys';
import { delay } from '@/mocks/delay';
import { technician } from '@/mocks/db';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { ProductCategory, Technician } from '@/types/domain';

/** Binding phase: `GET /me`. */
async function getMe(): Promise<Technician> {
  await delay('me');
  return technician;
}

/**
 * Push notifications is a switch rather than an "On" label: it's the one
 * setting here a technician actually flips, and it decides whether they hear
 * about new jobs at all. Language and payout account open their own flows, so
 * they stay as values.
 */
const SETTINGS: { label: string; value: string; icon: IconName }[] = [
  { label: 'Language', value: 'English', icon: 'globe' },
  { label: 'Payout account', value: '••4432', icon: 'wallet' },
];

/** The coverage row abbreviates, matching the prototype — the full names wrap. */
const SHORT_CATEGORY: Partial<Record<ProductCategory, string>> = {
  Television: 'TV',
  'Air Conditioner': 'AC',
  'Water Purifier': 'Purifier',
};

/** Screen 16 — Profile & settings. */
export function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useQuery({ queryKey: qk.me(), queryFn: getMe });
  const [pushEnabled, setPushEnabled] = useState(true);

  const initials = (me?.name ?? '')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const categories = me?.categories.map((c) => SHORT_CATEGORY[c] ?? c).join(' · ') ?? '—';

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="light" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={{
            backgroundColor: color.chrome,
            alignItems: 'center',
            paddingTop: insets.top + 22,
            paddingHorizontal: 20,
            paddingBottom: 24,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          {!me ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Skeleton width={74} height={74} rounded={22} />
              <Skeleton width={150} height={20} />
            </View>
          ) : (
            <>
              <View
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: 22,
                  backgroundColor: color.actionBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_900Black',
                    fontSize: 28,
                    color: color.actionFg,
                  }}
                >
                  {initials}
                </Text>
              </View>

              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 19,
                  color: color.textInverse,
                  marginTop: 12,
                }}
              >
                {me.name}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textOnChrome,
                  marginTop: 2,
                }}
              >
                Technician · ID {me.id}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' }}>
                <ChromeStat value={me.rating.toFixed(1)} label="Rating" />
                <ChromeStat value={String(me.jobsDone)} label="Jobs done" />
                <ChromeStat value={`${me.onTimePct}%`} label="On-time" />
              </View>
            </>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 11,
                letterSpacing: 0.88,
                textTransform: 'uppercase',
                color: color.textFootnote,
                marginBottom: 12,
              }}
            >
              Service coverage
            </Text>

            <CoverageRow label="Categories" value={categories} first />
            <CoverageRow label="Pincodes" value={me?.pincodes.join(', ') ?? '—'} />
          </View>

          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => router.push('/availability')}
              accessibilityRole="button"
              accessibilityLabel="Availability and bandwidth"
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 13,
                    paddingVertical: 15,
                    paddingHorizontal: 16,
                    backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
                  }}
                >
                  <Icon name="calendar" size={21} color={color.textLabel} strokeWidth={1.7} />
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: color.textPrimary,
                    }}
                  >
                    Availability &amp; bandwidth
                  </Text>
                  <Icon name="chevronRight" size={19} color={color.textMuted} />
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={() => setPushEnabled(!pushEnabled)}
              accessibilityRole="switch"
              accessibilityState={{ checked: pushEnabled }}
              accessibilityLabel="Push notifications"
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 13,
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderTopWidth: 1,
                  borderTopColor: palette.neutral[100],
                }}
              >
                <Icon name="bell" size={21} color={color.textLabel} strokeWidth={1.7} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14.5,
                    color: color.textPrimary,
                  }}
                >
                  Push notifications
                </Text>
                {/* Row is the tap target, so the switch is presentational. */}
                <Switch value={pushEnabled} onValueChange={setPushEnabled} static />
              </View>
            </Pressable>

            {SETTINGS.map((row) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 13,
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderTopWidth: 1,
                  borderTopColor: palette.neutral[100],
                }}
              >
                <Icon name={row.icon} size={21} color={color.textLabel} strokeWidth={1.7} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14.5,
                    color: color.textPrimary,
                  }}
                >
                  {row.label}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 13,
                    color: color.textMuted,
                  }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 16 }}>
            <Button
              label="Log out"
              variant="dangerOutline"
              onPress={() => router.replace('/(auth)/login')}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ChromeStat({ value, label }: { value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chromePanel,
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 17, color: color.textInverse }}>
        {value}
      </Text>
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textOnChrome }}>
        {label}
      </Text>
    </View>
  );
}

function CoverageRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 7,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.neutral[100],
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 13,
          color: color.textPrimary,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
