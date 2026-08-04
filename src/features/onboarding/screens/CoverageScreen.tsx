import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Header, Screen } from '@/components/layout';
import { Button, Card, Input } from '@/components/ui';
import { CategoryTile } from '@/features/onboarding/components/CategoryTile';
import { PincodeChip } from '@/features/onboarding/components/PincodeChip';
import { CATEGORIES } from '@/mocks/db';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { ProductCategory } from '@/types/domain';

const PINCODE_LENGTH = 6;

/**
 * R2 — Service coverage.
 *
 * This is the eligibility filter for the whole app: a job only ever reaches
 * this technician if its category is selected here AND its pincode is in the
 * list. Getting it wrong means an empty pool, so both are required before
 * continuing and the CTA says which one is missing.
 */
export function CoverageScreen() {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<ProductCategory>>(new Set());
  const [pincodes, setPincodes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();

  const canAdd = draft.length === PINCODE_LENGTH;
  const ready = selected.size > 0 && pincodes.length > 0;

  const hint = useMemo(() => {
    if (selected.size === 0) return 'Select at least one category';
    return 'Add at least one pincode';
  }, [selected.size]);

  const summary = useMemo(() => {
    const c = `${selected.size} ${selected.size === 1 ? 'category' : 'categories'}`;
    const p = `${pincodes.length} ${pincodes.length === 1 ? 'area' : 'areas'}`;
    return `${c} · ${p}`;
  }, [selected.size, pincodes.length]);

  const toggle = (category: ProductCategory) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const addPincode = () => {
    if (!canAdd) return;
    if (pincodes.includes(draft)) {
      setError('That pincode is already added.');
      return;
    }
    setPincodes((prev) => [...prev, draft]);
    setDraft('');
    setError(undefined);
  };

  return (
    <>
      <Header title="Service coverage" showBack />

      <Screen
        footer={
          <>
            <Button
              label="Continue"
              onPress={() => router.push('/login')}
              disabled={!ready}
              disabledHint={hint}
            />
            {ready ? (
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12,
                  color: color.textMuted,
                  textAlign: 'center',
                  marginTop: 8,
                }}
              >
                {summary}
              </Text>
            ) : null}
          </>
        }
      >
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 20,
            color: color.textPrimary,
            marginTop: 4,
          }}
        >
          What do you install?
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            lineHeight: 19,
            color: color.textSecondary,
            marginTop: 6,
            marginBottom: 16,
          }}
        >
          Pick every category you&apos;re trained for. You&apos;ll only be offered jobs that match
          — pick more to get more work.
        </Text>

        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}
        >
          {CATEGORIES.map((category) => (
            <CategoryTile
              key={category}
              category={category}
              selected={selected.has(category)}
              onToggle={() => toggle(category)}
            />
          ))}
        </View>

        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 20,
            color: color.textPrimary,
            marginTop: 32,
          }}
        >
          Which areas do you cover?
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13,
            lineHeight: 19,
            color: color.textSecondary,
            marginTop: 6,
            marginBottom: 16,
          }}
        >
          Add every pincode you can service — you&apos;ll be offered jobs from any of them.
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Input
              value={draft}
              onChangeText={(v) => {
                setDraft(v.replace(/\D/g, '').slice(0, PINCODE_LENGTH));
                setError(undefined);
              }}
              placeholder="400067"
              keyboardType="number-pad"
              maxLength={PINCODE_LENGTH}
              error={error}
            />
          </View>

          <Pressable
            onPress={addPincode}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Add pincode"
          >
            {({ pressed }) => (
              <View
                style={{
                  height: 52,
                  paddingHorizontal: 22,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canAdd ? color.actionBg : color.actionBgDisabled,
                  opacity: pressed ? 0.85 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 15,
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            {pincodes.map((code) => (
              <PincodeChip
                key={code}
                code={code}
                onRemove={() => setPincodes((prev) => prev.filter((c) => c !== code))}
              />
            ))}
          </View>
        ) : (
          <Card variant="flat" style={{ backgroundColor: color.surfaceSunken, marginTop: 16 }}>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 13,
                lineHeight: 19,
                color: color.textSecondary,
              }}
            >
              Add at least one pincode. Most technicians cover 2–5 nearby areas.
            </Text>
          </Card>
        )}
      </Screen>
    </>
  );
}
