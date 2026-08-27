import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Switch } from '@/components/ui';
import {
  useDailyJobCap,
  useJobsToday,
  useSetDailyJobCap,
} from '@/features/availability/hooks/useAvailability';
import { color } from '@/theme/semantic';

/** Where the stepper starts when somebody switches a limit on. */
const BANDWIDTH_DEFAULT = 6;
/** A cap of 0 means "never offer me work", which is what going offline says. */
const BANDWIDTH_MIN = 1;

/**
 * How long the stepper waits before saving.
 *
 * Long enough that walking 3 → 7 is one request rather than four, short enough
 * that nobody notices it. Every tap used to PATCH, on the connection a field
 * technician actually has.
 */
const SAVE_DEBOUNCE_MS = 700;

/**
 * Screen 3 — Availability & bandwidth.
 *
 * Bandwidth is a plain jobs-per-day cap, not weighted by job type or duration.
 * The requirements doc left that open (Q3); the prototype settles it, and a
 * count is the only version a technician can reason about in the field.
 *
 * **A new technician arrives with no limit.** Neither the ops console's Add
 * screen nor the joining flow asks for one — a number invented before anybody
 * has worked a day is a number nobody has a basis for.
 *
 * ## What used to be here
 *
 * A weekday grid and a "Mark time off" switch, both of which wrote to Zustand
 * and nowhere else. Neither had a table, a column or an endpoint behind it, the
 * `9–6` / `10–4` hours were hardcoded display strings tied to no data, and time
 * off duplicated the Home online toggle — which is real and genuinely stops
 * offers. They are gone rather than wired: the honest screen is the small one.
 *
 * The cap is now server state and lives in Query under hard rule 3, like the
 * online toggle before it. The warning that used to sit here — "what this screen
 * changes does NOT reach the server" — is what the change deletes.
 */
export function AvailabilityScreen() {
  // `undefined` while the profile loads; `null` means NO LIMIT.
  const cap = useDailyJobCap();
  const jobsToday = useJobsToday();
  const { mutate: setBandwidth } = useSetDailyJobCap();

  // What the technician has tapped but the server has not been told yet.
  // `undefined` means "nothing pending, show the server's answer".
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const pending = useRef<{ value: number | null; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );

  const save = useCallback(
    (next: number | null) => {
      setDraft(next);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = {
        value: next,
        timer: setTimeout(() => {
          pending.current = null;
          setBandwidth(next, { onSettled: () => setDraft(undefined) });
        }, SAVE_DEBOUNCE_MS),
      };
    },
    [setBandwidth],
  );

  // Leaving the screen mid-debounce must not discard the change. Tapping "+"
  // and immediately going back is an ordinary thing to do, and losing the
  // setting there would be the exact bug this screen was rewritten to fix.
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        setBandwidth(pending.current.value);
        pending.current = null;
      }
    },
    [setBandwidth],
  );

  // Three states, not two. Coalescing `undefined` to `null` would render "no
  // limit" at a technician who has one, for as long as the profile takes to
  // arrive — and then flip under them. Loading is its own answer.
  const loading = cap === undefined && draft === undefined;
  const bandwidthPerDay = draft !== undefined ? draft : (cap ?? null);
  const limited = !loading && bandwidthPerDay !== null;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Availability & bandwidth" paddingBottom={14} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
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
            {loading
              ? 'Loading your current limit…'
              : limited
                ? "Maximum installs you'll take per day. New offers stop once you hit this cap."
                : "You'll be offered as many installs a day as come up. Set a cap if you'd rather not."}
          </Text>

          <Pressable
            onPress={loading ? undefined : () => save(limited ? null : BANDWIDTH_DEFAULT)}
            disabled={loading}
            accessibilityRole="switch"
            accessibilityState={{ checked: limited, disabled: loading }}
            accessibilityLabel="Limit jobs per day"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: limited ? 18 : 0,
            }}
          >
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 14,
                color: color.textPrimary,
              }}
            >
              Limit jobs per day
            </Text>
            <Switch
              value={limited}
              onValueChange={() => save(limited ? null : BANDWIDTH_DEFAULT)}
            />
          </Pressable>

          {limited ? (
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
              onPress={() => bandwidthPerDay && save(bandwidthPerDay - 1)}
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

            {/* No ceiling — a technician may take as many as they will. */}
            <StepperButton
              glyph="+"
              onPress={() => bandwidthPerDay && save(bandwidthPerDay + 1)}
              disabled={bandwidthPerDay === null}
              label="Increase bandwidth"
            />
          </View>
          ) : null}

          {/* What the number MEANS today. A cap on its own is a setting; "2 of
              3 used today" is the thing a technician actually wants to know
              before deciding whether to change it.

              Counted the way the server enforces it — closed jobs included —
              so this can never disagree with a refused accept. */}
          {limited && jobsToday !== undefined ? (
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                color: color.textMuted,
                textAlign: 'center',
                marginTop: 14,
              }}
            >
              {jobsToday} of {bandwidthPerDay} used today
            </Text>
          ) : null}
        </View>

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
