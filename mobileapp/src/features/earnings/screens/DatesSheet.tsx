import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Sheet } from '@/components/ui';
import {
  RangeCalendar,
  type Selection,
} from '@/features/earnings/components/RangeCalendar';
import { useEarningsWindow } from '@/store/earnings.store';
import { color } from '@/theme/semantic';
import type { DateRange } from '@/types/domain';
import { formatRange, spanDays, today } from '@/utils/date';

/**
 * The Earnings date-range picker.
 *
 * A `transparentModal` route like every other sheet in this app — accept-slot
 * and the avatar picker are the same shape — rather than a React Native
 * `Modal`. Three things follow from that and all three matter:
 *
 *  - the entrance is a Reanimated LAYOUT animation, and layout animations
 *    inside an RN `Modal` are the one place Reanimated does not promise them;
 *  - a `Modal` is its own window, so a push notification opening a job would
 *    have left this sheet floating over it with the tab bar underneath;
 *  - it sits under `(app)`, so it inherits that layout's signed-in guard
 *    instead of needing its own.
 *
 * Net-new UI. The prototype has no period control on the Earnings screen at
 * all, so this whole screen's copy needs sign-off with the rest of it.
 */
export function DatesSheet() {
  const router = useRouter();
  const window = useEarningsWindow((s) => s.window);
  const setWindow = useEarningsWindow((s) => s.setWindow);

  const latest = today();
  // Reopening starts where they left off, so nudging one end of a span does not
  // mean re-picking both.
  const [selection, setSelection] = useState<Selection | null>(() =>
    window.kind === 'range' ? { from: window.range.from, to: window.range.to } : null,
  );

  // The finished span, or null while one end is still missing. Narrowing once
  // here is what keeps the three places below from each re-checking `to`.
  const range: DateRange | null =
    selection && selection.to !== null
      ? { from: selection.from, to: selection.to }
      : null;

  const apply = () => {
    if (!range) return;
    setWindow({ kind: 'range', range });
    router.back();
  };

  return (
    <Sheet onDismiss={() => router.back()}>
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary }}>
        Pick dates
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13.5,
          lineHeight: 20,
          color: color.textLabel,
          marginTop: 6,
          marginBottom: 14,
        }}
      >
        {range
          ? describe(range)
          : selection
            ? 'Now tap the last day.'
            : 'Tap the first day, then the last.'}
      </Text>

      <RangeCalendar value={selection} onChange={setSelection} latest={latest} />

      <View style={{ marginTop: 18 }}>
        <Button
          label="Show earnings"
          disabled={!range}
          // Blocked, the hint says what is missing rather than leaving a dead
          // control — the same pattern as the coverage and profile steps.
          disabledHint={selection ? 'Tap the last day' : 'Tap two dates'}
          onPress={apply}
        />
      </View>
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
    </Sheet>
  );
}

/** "12 Aug – 2 Sep · 22 days". The count is what a span of dates does not say. */
function describe({ from, to }: DateRange): string {
  const days = spanDays(from, to);
  return `${formatRange(from, to)} · ${days === 1 ? '1 day' : `${days} days`}`;
}
