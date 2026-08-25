import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { KeyboardFlow, ScreenStatusBar } from '@/components/layout';
import { Button, StepDots } from '@/components/ui';
import { CategoryTile } from '@/features/onboarding/components/CategoryTile';
import {
  REGISTRATION_STEP_COUNT,
  stepNumber,
  useRegistration,
} from '@/store/registration.store';
import { color } from '@/theme/semantic';


/**
 * R2 — Service coverage.
 *
 * The eligibility filter for the whole app: a job only reaches this technician
 * if its subcategory is selected here AND its pincode is listed. Get it wrong
 * and the pool is silently empty forever, which is why both are mandatory and
 * the blocked CTA names the missing half.
 *
 * Tiles are one per SUBCATEGORY, grouped under their parent's name — that is
 * the level a job offer matches on, and once a company has more than a handful
 * an ungrouped grid reads as one long list.
 *
 * When an area manager sent the invite, the pincode field becomes a picker over
 * the areas THEY cover. The technician cannot serve outside their manager's
 * territory, and offering free entry would only produce a refusal at the end of
 * the flow.
 *
 * Layout is taken verbatim from the prototype: white page, 22px gutters, a
 * fixed footer above a hairline, and tiles at 50%-6px against a 12px gap.
 */
export function CoverageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const draft = useRegistration((s) => s.draft);
  const setCoverage = useRegistration((s) => s.setCoverage);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(draft?.subcategoryIds ?? []),
  );
  // Assigned by the manager on the invite. Read-only here: this screen shows
  // where they will work, it does not ask.
  const pincodes = draft?.invite.pincodes ?? [];

  const ready = selected.size > 0;

  const hint = 'Select at least one category';

  const summary = useMemo(() => {
    const c = `${selected.size} ${selected.size === 1 ? 'category' : 'categories'}`;
    const p = `${pincodes.length} ${pincodes.length === 1 ? 'area' : 'areas'}`;
    return `${c} · ${p}`;
  }, [selected.size, pincodes.length]);

  // Reachable only mid-registration. Any other way in means the draft was
  // cleared underneath us.
  if (!draft) {
    router.replace('/(auth)/login');
    return null;
  }

  const toggle = (subcategoryId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subcategoryId)) next.delete(subcategoryId);
      else next.add(subcategoryId);
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.surfaceRaised }}>
      <ScreenStatusBar style="dark" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingTop: insets.top + 6,
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          {({ pressed }) => (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? color.surfaceSunken : 'transparent',
              }}
            >
              <Icon name="chevronLeft" size={24} color={color.textPrimary} />
            </View>
          )}
        </Pressable>

        <View style={{ marginLeft: 'auto', marginRight: 8 }}>
          <StepDots
            total={REGISTRATION_STEP_COUNT}
            current={stepNumber('coverage')}
          />
        </View>
      </View>

      {/* Wraps BOTH the scroll and the footer so the CTA rides above the
          keyboard instead of being buried by it. */}
      <KeyboardFlow
        footer={
          <View
            style={{
              paddingTop: 12,
              paddingHorizontal: 22,
              paddingBottom: 16,
              borderTopWidth: 1,
              borderTopColor: color.surface,
            }}
          >
            {/* When blocked, the hint IS the button label rather than a line
                beneath it — one control, always saying what it needs. */}
            <Button
              label={ready ? `Continue · ${summary}` : hint}
              onPress={() => {
                setCoverage([...selected], pincodes);
                router.push('/register/verify');
              }}
              disabled={!ready}
            />
          </View>
        }
      >
        <View style={{ paddingTop: 6, paddingHorizontal: 22, paddingBottom: 20 }}>
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 24,
              lineHeight: 28,
              letterSpacing: -0.5,
              color: color.textPrimary,
            }}
          >
            What do you install?
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
              marginTop: 8,
            }}
          >
            Pick every category you&apos;re trained for. You&apos;ll only be offered jobs that
            match — pick more to get more work.
          </Text>

          {draft.invite.categories.map((category) => (
            <View key={category.id} style={{ marginTop: 22 }}>
              {/* Only worth a heading when there is more than one group —
                  otherwise it is a label over the entire list. */}
              {draft.invite.categories.length > 1 ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 12,
                    letterSpacing: 0.4,
                    color: color.textLabel,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  {category.name}
                </Text>
              ) : null}

              {/* Pulled out by -6 so the tiles' own 6px padding produces a 12px
                  inner gutter while the outer edges stay flush with the gutter.
                  No `gap` here — see CategoryTile for why it breaks the grid. */}
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}
              >
                {category.subcategories.map((sub) => (
                  <CategoryTile
                    key={sub.id}
                    category={sub.name}
                    iconKey={sub.iconKey}
                    selected={selected.has(sub.id)}
                    onToggle={() => toggle(sub.id)}
                  />
                ))}
              </View>
            </View>
          ))}

          <View style={{ marginTop: 26 }}>
            <Text
              style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: color.textPrimary }}
            >
              Your service areas
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 13,
                lineHeight: 20,
                color: color.textSecondary,
                marginTop: 6,
              }}
            >
              {draft.invite.invitedByName
                ? `Set by ${draft.invite.invitedByName}. You'll be offered jobs from any of these.`
                : "Set by your manager. You'll be offered jobs from any of these."}
            </Text>

            {/* Read-only: coverage is the manager's decision, so this reports
                it rather than asking. A technician who needs a different area
                asks the person who assigned it. */}
            {pincodes.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 }}>
                {pincodes.map((code) => (
                  <View
                    key={code}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 7,
                      height: 40,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1.5,
                      borderColor: color.border,
                      backgroundColor: color.surfaceRaised,
                    }}
                  >
                    <Icon name="geo" size={15} color={color.textMuted} />
                    <Text
                      style={{
                        fontFamily: 'RobotoMono_700Bold',
                        fontSize: 13,
                        color: color.textPrimary,
                      }}
                    >
                      {code}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              /* Should not happen — an invite cannot be sent without coverage —
                 but an empty list is a real state and saying nothing would look
                 like a screen that failed to load. */
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12,
                  lineHeight: 17,
                  color: color.textMuted,
                  marginTop: 12,
                }}
              >
                No areas assigned yet — ask your manager before you finish.
              </Text>
            )}
          </View>
        </View>
      </KeyboardFlow>
    </View>
  );
}
