import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { TitleBar } from '@/components/layout';
import { Switch } from '@/components/ui';
import {
  BANDWIDTH_MAX,
  BANDWIDTH_MIN,
  useAvailabilityStore,
  useBandwidthPerDay,
} from '@/store/availability.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
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
 * The requirements doc left that open (Q3); the prototype settles it, and a
 * count is the only version a technician can reason about in the field.
 */
export function AvailabilityScreen() {
  const { days, timeOff, toggleDay, setBandwidth, setTimeOff } = useAvailabilityStore();

  // Their own edit if they made one, otherwise the cap their manager set.
  // Null means the profile has not loaded yet — a dash, never a guess, because
  // this number tells a technician how much work they will be offered.
  const bandwidthPerDay = useBandwidthPerDay();

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <StatusBar style="dark" />
      <TitleBar title="Availability & bandwidth" paddingBottom={14} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel>Working days</SectionLabel>

        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: 16,
            paddingVertical: 8,
            paddingHorizontal: 6,
            marginBottom: 20,
          }}
        >
          {DAYS.map((day, i) => {
            const active = days[day.key];

            return (
              <Pressable
                key={day.key}
                onPress={() => toggleDay(day.key)}
                accessibilityRole="switch"
                accessibilityState={{ checked: active }}
                accessibilityLabel={day.label}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 11,
                    paddingHorizontal: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: palette.neutral[100],
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Roboto_500Medium',
                      fontSize: 14.5,
                      color: active ? color.textPrimary : color.textMuted,
                    }}
                  >
                    {day.label}
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text
                      style={{
                        fontFamily: 'Roboto_400Regular',
                        fontSize: 12.5,
                        color: color.textMuted,
                      }}
                    >
                      {active ? day.hours : 'Off'}
                    </Text>
                    {/* Row is the tap target, so the switch is presentational. */}
                    <Switch value={active} onValueChange={() => toggleDay(day.key)} static />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>Daily job bandwidth</SectionLabel>

        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: 16,
            padding: 18,
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              lineHeight: 20,
              color: color.textLabel,
              marginBottom: 14,
            }}
          >
            Maximum installs you&apos;ll take per day. New offers stop once you hit this cap.
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
            }}
          >
            <StepperButton
              glyph="−"
              onPress={() => bandwidthPerDay && setBandwidth(bandwidthPerDay - 1)}
              disabled={bandwidthPerDay === null || bandwidthPerDay <= BANDWIDTH_MIN}
              label="Decrease bandwidth"
            />

            <View style={{ alignItems: 'center', minWidth: 56 }}>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 34,
                  lineHeight: 36,
                  color: color.textPrimary,
                }}
              >
                {bandwidthPerDay ?? '—'}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 11,
                  color: color.textMuted,
                  marginTop: 2,
                }}
              >
                jobs / day
              </Text>
            </View>

            <StepperButton
              glyph="+"
              onPress={() => bandwidthPerDay && setBandwidth(bandwidthPerDay + 1)}
              disabled={bandwidthPerDay === null || bandwidthPerDay >= BANDWIDTH_MAX}
              label="Increase bandwidth"
            />
          </View>
        </View>

        <Pressable
          onPress={() => setTimeOff(!timeOff)}
          accessibilityRole="switch"
          accessibilityState={{ checked: timeOff }}
          accessibilityLabel="Mark time off"
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              padding: 15,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: color.slotBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="calendar" size={22} color={palette.secondary[600]} strokeWidth={1.7} />
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 14.5,
                  color: color.textPrimary,
                }}
              >
                Mark time off
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textSecondary,
                }}
              >
                {timeOff ? 'Time off is on — no offers today' : 'You are available today'}
              </Text>
            </View>

            <Switch
              value={timeOff}
              onValueChange={setTimeOff}
              activeColor={palette.secondary[600]}
              static
            />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_700Bold',
        fontSize: 11,
        letterSpacing: 0.88, // .08em at 11px
        textTransform: 'uppercase',
        color: color.textFootnote,
        marginTop: 2,
        marginHorizontal: 4,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

interface StepperButtonProps {
  glyph: '+' | '−';
  onPress: () => void;
  disabled: boolean;
  label: string;
}

/**
 * The prototype draws these as typographic glyphs inside an outlined square,
 * not as stroked icons — so the minus is a true U+2212, which lines up
 * optically with the plus in a way a hyphen does not.
 */
function StepperButton({ glyph, onPress, disabled, label }: StepperButtonProps) {
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
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: color.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? color.surfaceSunkenAlt : 'transparent',
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 24,
              lineHeight: 28,
              color: color.textPrimary,
            }}
          >
            {glyph}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
