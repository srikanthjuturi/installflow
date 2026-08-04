import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * SCAFFOLD PLACEHOLDER — replaced by the real R1 invite screen in a later
 * commit. It exists now to prove the toolchain end-to-end on a device:
 * Expo Router, NativeWind classes, the token ramps, and all four Roboto
 * weights rendering.
 *
 * Class names are written out in full on purpose. Tailwind scans source
 * statically, so an interpolated `bg-${name}-${step}` would never be
 * generated and the swatch would render transparent.
 */

const RAMPS = [
  {
    name: 'Primary',
    label: 'Actions, links, accept',
    steps: ['bg-primary-100', 'bg-primary-300', 'bg-primary-500', 'bg-primary-700', 'bg-primary-900'],
  },
  {
    name: 'Secondary',
    label: 'Committed slot, bonus',
    steps: [
      'bg-secondary-100',
      'bg-secondary-300',
      'bg-secondary-500',
      'bg-secondary-700',
      'bg-secondary-900',
    ],
  },
  {
    name: 'Success',
    label: 'Completed, credit',
    steps: ['bg-success-100', 'bg-success-300', 'bg-success-500', 'bg-success-700', 'bg-success-900'],
  },
  {
    name: 'Danger',
    label: 'Penalty, cancel',
    steps: ['bg-danger-100', 'bg-danger-300', 'bg-danger-500', 'bg-danger-700', 'bg-danger-900'],
  },
] as const;

const STEP_LABELS = ['100', '300', '500', '700', '900'] as const;

export default function InvitePlaceholder() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-neutral-150">
      <View className="bg-chrome px-5 pb-5" style={{ paddingTop: insets.top + 16 }}>
        <Text className="font-bold text-[11px] tracking-[1.4px] text-neutral-400">
          SCAFFOLD CHECK
        </Text>
        <Text className="mt-1.5 font-black text-[25px] leading-[30px] text-neutral-0">
          Videocon Technician
        </Text>
        <Text className="mt-1 text-[13px] text-neutral-400">
          Expo SDK 54 · NativeWind · design tokens
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="rounded-lg border border-neutral-200 bg-neutral-0 p-4">
          <Text className="font-bold text-[15px] text-neutral-900">Roboto weights</Text>
          <Text className="mt-3 text-[15px] text-neutral-900">Regular 400 — body copy</Text>
          <Text className="mt-1 font-medium text-[15px] text-neutral-900">Medium 500 — labels</Text>
          <Text className="mt-1 font-bold text-[15px] text-neutral-900">Bold 700 — titles</Text>
          <Text className="mt-1 font-black text-[15px] text-neutral-900">Black 900 — numbers</Text>
        </View>

        <Text className="mb-3 mt-6 font-bold text-[11px] tracking-[1.4px] text-neutral-500">
          COLOUR RAMPS
        </Text>

        {RAMPS.map((ramp) => (
          <View
            key={ramp.name}
            className="mb-3 rounded-lg border border-neutral-200 bg-neutral-0 p-4"
          >
            <Text className="font-bold text-[14px] text-neutral-900">{ramp.name}</Text>
            <Text className="mb-3 text-[12px] text-neutral-500">{ramp.label}</Text>
            <View className="flex-row gap-2">
              {ramp.steps.map((swatch, i) => (
                <View key={swatch} className="flex-1 items-center">
                  <View className={`h-11 w-full rounded-md ${swatch}`} />
                  <Text className="mt-1 text-[10px] text-neutral-400">{STEP_LABELS[i]}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View className="mt-2 rounded-lg bg-secondary-100 p-4">
          <Text className="font-bold text-[13px] text-secondary-800">Committed slot</Text>
          <Text className="mt-1 text-[12px] text-secondary-800">
            Amber is reserved for the slot the customer already confirmed.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
