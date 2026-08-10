import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Button, StepDots } from '@/components/ui';
import { CategoryTile } from '@/features/onboarding/components/CategoryTile';
import { PincodeChip } from '@/features/onboarding/components/PincodeChip';
import {
  REGISTRATION_STEP_COUNT,
  stepNumber,
  useRegistration,
} from '@/store/registration.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

const PINCODE_LENGTH = 6;

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
  const scrollRef = useRef<ScrollView>(null);

  const draft = useRegistration((s) => s.draft);
  const setCoverage = useRegistration((s) => s.setCoverage);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(draft?.subcategoryIds ?? []),
  );
  const [pincodes, setPincodes] = useState<string[]>(draft?.pincodes ?? []);
  const [pincodeDraft, setPincodeDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const allowed = draft?.invite.allowedPincodes ?? null;
  const restricted = allowed !== null;

  const canAdd = pincodeDraft.length === PINCODE_LENGTH;
  const ready = selected.size > 0 && pincodes.length > 0;

  const hint =
    selected.size === 0 ? 'Select at least one category' : 'Add at least one pincode';

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

  const togglePincode = (code: string) =>
    setPincodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  const addPincode = () => {
    if (!canAdd || pincodes.includes(pincodeDraft)) return;
    setPincodes((prev) => [...prev, pincodeDraft]);
    setPincodeDraft('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.surfaceRaised }}>
      <StatusBar style="dark" />

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
          keyboard instead of being buried by it. Android resizes the window
          itself (softwareKeyboardLayoutMode: resize), so it needs no behavior. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 22, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
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
              Which areas do you cover?
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
              {restricted
                ? 'Pick the areas you can service. These are the areas your manager covers.'
                : 'Add every pincode you can service — you’ll be offered jobs from any of them.'}
            </Text>

            {restricted ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 }}>
                {allowed.map((code) => {
                  const on = pincodes.includes(code);
                  return (
                    <Pressable
                      key={code}
                      onPress={() => togglePincode(code)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Pincode ${code}`}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          height: 40,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                          borderWidth: 1.5,
                          borderColor: on ? color.actionBg : color.border,
                          backgroundColor: on ? palette.primary[50] : color.surfaceRaised,
                        }}
                      >
                        <Icon
                          name={on ? 'check' : 'geo'}
                          size={on ? 13 : 15}
                          color={on ? color.actionBg : color.textMuted}
                        />
                        <Text
                          style={{
                            fontFamily: 'RobotoMono_700Bold',
                            fontSize: 13,
                            color: on ? color.actionBg : color.textPrimary,
                          }}
                        >
                          {code}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <TextInput
                    value={pincodeDraft}
                    onChangeText={(v) =>
                      setPincodeDraft(v.replace(/\D/g, '').slice(0, PINCODE_LENGTH))
                    }
                    onFocus={() => {
                      setFocused(true);
                      // The pincode field sits at the very bottom of a long
                      // scroll. Resizing alone leaves it flush against the
                      // keyboard, so pull it fully into view once the frame
                      // has settled.
                      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
                    }}
                    onBlur={() => setFocused(false)}
                    placeholder="Enter 6-digit pincode"
                    placeholderTextColor={color.textMuted}
                    keyboardType="number-pad"
                    maxLength={PINCODE_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={addPincode}
                    style={{
                      flex: 1,
                      height: 50,
                      borderWidth: 1.5,
                      borderColor: focused ? color.borderFocus : color.borderStrong,
                      borderRadius: 13,
                      paddingHorizontal: 15,
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 15,
                      color: color.textPrimary,
                      backgroundColor: color.surfaceRaised,
                    }}
                  />

                  <Pressable
                    onPress={addPincode}
                    disabled={!canAdd}
                    accessibilityRole="button"
                    accessibilityLabel="Add pincode"
                  >
                    {({ pressed }) => (
                      <View
                        style={{
                          width: 66,
                          height: 50,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: canAdd ? color.actionBg : color.actionBgDisabled,
                          opacity: pressed ? 0.85 : 1,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: 'Roboto_700Bold',
                            fontSize: 14,
                            color: canAdd ? color.actionFg : color.actionFgDisabled,
                          }}
                        >
                          Add
                        </Text>
                      </View>
                    )}
                  </Pressable>
                </View>

                {pincodes.length > 0 ? (
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 14 }}
                  >
                    {pincodes.map((code) => (
                      <PincodeChip
                        key={code}
                        code={code}
                        onRemove={() => setPincodes((prev) => prev.filter((c) => c !== code))}
                      />
                    ))}
                  </View>
                ) : (
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      lineHeight: 17,
                      color: color.textMuted,
                      marginTop: 12,
                    }}
                  >
                    Add at least one pincode. Most technicians cover 2–5 nearby areas.
                  </Text>
                )}
              </>
            )}
          </View>
        </ScrollView>

        <View
          style={{
            paddingTop: 12,
            paddingHorizontal: 22,
            paddingBottom: insets.bottom + 16,
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
      </KeyboardAvoidingView>
    </View>
  );
}
