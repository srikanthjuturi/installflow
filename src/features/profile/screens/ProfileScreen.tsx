import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card } from '@/components/ui';
import { qk } from '@/lib/queryKeys';
import { technician } from '@/mocks/db';
import { delay } from '@/mocks/delay';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { Technician } from '@/types/domain';

/** Binding phase: `GET /me`. */
async function getMe(): Promise<Technician> {
  await delay('me');
  return technician;
}

const SETTINGS: { label: string; value: string; icon: IconName }[] = [
  { label: 'Push notifications', value: 'On', icon: 'bell' },
  { label: 'Language', value: 'English', icon: 'globe' },
  { label: 'Payout account', value: '••4432', icon: 'wallet' },
];

/** Screen 16 — Profile & settings. */
export function ProfileScreen() {
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: qk.me(), queryFn: getMe });

  const initials = (me?.name ?? '')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Header title="Profile" showBack={false} />

      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: 22 }}>
          {/* Guard on the value, not on isPending: destructuring the query
              result breaks TanStack's discriminated union, so isPending can't
              narrow `me` for TypeScript. */}
          {!me ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Skeleton width={64} height={64} rounded={radius.full} />
              <Skeleton width={140} height={18} />
            </View>
          ) : (
            <>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.full,
                  backgroundColor: color.actionBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_900Black',
                    fontSize: 24,
                    color: color.actionFg,
                  }}
                >
                  {initials}
                </Text>
              </View>

              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 20,
                  color: color.textPrimary,
                  marginTop: 12,
                }}
              >
                {me.name}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textSecondary,
                  marginTop: 2,
                }}
              >
                Technician · ID {me.id}
              </Text>

              <View style={{ flexDirection: 'row', marginTop: 20, alignSelf: 'stretch' }}>
                <Stat value={me.rating.toFixed(1)} label="Rating" />
                <Stat value={String(me.jobsDone)} label="Jobs done" divider />
                <Stat value={`${me.onTimePct}%`} label="On-time" divider />
              </View>
            </>
          )}
        </Card>

        <SectionLabel>SERVICE COVERAGE</SectionLabel>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <CoverageRow label="Categories" value={me?.categories.join(', ') ?? '—'} first />
          <CoverageRow label="Pincodes" value={me?.pincodes.join(', ') ?? '—'} />
        </Card>

        <Pressable
          onPress={() => router.push('/availability')}
          accessibilityRole="button"
          style={{ marginTop: 12 }}
        >
          {({ pressed }) => (
            <Card style={{ opacity: pressed ? 0.7 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Icon name="jobs" size={20} color={color.actionBg} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 14,
                    color: color.textPrimary,
                  }}
                >
                  Availability &amp; bandwidth
                </Text>
                <Text style={{ fontSize: 18, color: color.textMuted }}>›</Text>
              </View>
            </Card>
          )}
        </Pressable>

        <SectionLabel>SETTINGS</SectionLabel>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {SETTINGS.map((row, i) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: color.border,
              }}
            >
              <Icon name={row.icon} size={19} color={color.textSecondary} />
              <Text
                style={{
                  flex: 1,
                  fontFamily: 'Roboto_500Medium',
                  fontSize: 14,
                  color: color.textPrimary,
                }}
              >
                {row.label}
              </Text>
              <Text
                style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textMuted }}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </Card>

        <View style={{ marginTop: 24 }}>
          <Button
            label="Log out"
            variant="secondary"
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      </Screen>
    </>
  );
}

function Stat({ value, label, divider }: { value: string; label: string; divider?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        borderLeftWidth: divider ? 1 : 0,
        borderLeftColor: color.border,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 18, color: color.textPrimary }}>
        {value}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 11.5,
          color: color.textMuted,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function CoverageRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View
      style={{
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.border,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 12, color: color.textMuted }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_500Medium',
          fontSize: 14,
          color: color.textPrimary,
          marginTop: 3,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_700Bold',
        fontSize: 11,
        letterSpacing: 1.4,
        color: color.textSecondary,
        marginTop: 26,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}
