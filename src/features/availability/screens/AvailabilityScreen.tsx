import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Card, Switch } from '@/components/ui';
import {
  BANDWIDTH_MAX,
  BANDWIDTH_MIN,
  useAvailabilityStore,
} from '@/store/availability.store';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { WeekdayKey } from '@/types/domain';

const DAYS: { key: WeekdayKey; label: string; hours: string }[] = [
  { key: 'Mon', label: 'Monday', hours: '9–6' },
  { key: 'Tue', label: 'Tuesday', hours: '9–6' },
  { key: 'Wed', label: 'Wednesday', hours: '9–6' },
  { key: 'Thu', label: 'Thursday', hours: '9–6' },
  { key: 'Fri', label: 'Friday', hours: '9–6' },
  { key: 'Sat', label: 'Saturday', hours: '10–4' },
  { key: 'Sun', label: 'Sunday', hours: '9–6' },
];

/**
 * Screen 3 — Availability & bandwidth.
 *
 * Bandwidth is a plain jobs-per-day cap, not weighted by job type or duration.
 * The requirements doc left that open; the prototype settles it, and a count
 * is what a technician can actually reason about in the field.
 */
export function AvailabilityScreen() {
  const { days, bandwidthPerDay, timeOff, toggleDay, setBandwidth, setTimeOff } =
    useAvailabilityStore();

  return (
    <>
      <Header title="Availability & bandwidth" />

      <Screen>
        <SectionTitle>Working days</SectionTitle>
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          {DAYS.map((day, i) => {
            const active = days[day.key];
            return (
              <View
                key={day.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 13,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: color.border,
                }}
              >
                <View>
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14,
                      color: active ? color.textPrimary : color.textMuted,
                    }}
                  >
                    {day.label}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      color: color.textMuted,
                      marginTop: 1,
                    }}
                  >
                    {active ? day.hours : 'Off'}
                  </Text>
                </View>

                <Switch
                  value={active}
                  onValueChange={() => toggleDay(day.key)}
                  accessibilityLabel={day.label}
                />
              </View>
            );
          })}
        </Card>

        <SectionTitle>Daily job bandwidth</SectionTitle>
        <Card>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              lineHeight: 19,
              color: color.textSecondary,
              marginBottom: 18,
            }}
          >
            Maximum installs you&apos;ll take per day. New offers stop once you hit this cap.
          </Text>

          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <StepperButton
              icon="minus"
              onPress={() => setBandwidth(bandwidthPerDay - 1)}
              disabled={bandwidthPerDay <= BANDWIDTH_MIN}
              label="Decrease bandwidth"
            />

            <View style={{ alignItems: 'center' }}>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 34,
                  color: color.textPrimary,
                  letterSpacing: -1,
                }}
              >
                {bandwidthPerDay}
              </Text>
              <Text
                style={{ fontFamily: 'Roboto_400Regular', fontSize: 12, color: color.textMuted }}
              >
                jobs / day
              </Text>
            </View>

            <StepperButton
              icon="plus"
              onPress={() => setBandwidth(bandwidthPerDay + 1)}
              disabled={bandwidthPerDay >= BANDWIDTH_MAX}
              label="Increase bandwidth"
            />
          </View>
        </Card>

        <SectionTitle>Time off</SectionTitle>
        <Card>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text
                style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.textPrimary }}
              >
                Mark time off
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  lineHeight: 18,
                  color: color.textSecondary,
                  marginTop: 2,
                }}
              >
                {timeOff ? 'Time off is on — no offers today' : 'You are available today'}
              </Text>
            </View>

            <Switch
              value={timeOff}
              onValueChange={setTimeOff}
              activeColor={color.bonus}
              accessibilityLabel="Mark time off"
            />
          </View>
        </Card>
      </Screen>
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_700Bold',
        fontSize: 11,
        letterSpacing: 1.4,
        color: color.textSecondary,
        marginTop: 24,
        marginBottom: 10,
      }}
    >
      {children.toUpperCase()}
    </Text>
  );
}

interface StepperButtonProps {
  icon: 'plus' | 'minus';
  onPress: () => void;
  disabled: boolean;
  label: string;
}

function StepperButton({ icon, onPress, disabled, label }: StepperButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.border,
            backgroundColor: color.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
          }}
        >
          <Icon name={icon} size={22} color={color.textPrimary} />
        </View>
      )}
    </Pressable>
  );
}
