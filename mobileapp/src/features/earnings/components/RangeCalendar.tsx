import { useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { MAX_RANGE_DAYS } from '@/types/domain';
import {
  WEEKDAY_INITIALS,
  addMonths,
  formatDay,
  monthMatrix,
  monthTitle,
  spanDays,
  startOfMonth,
} from '@/utils/date';

/**
 * A range mid-selection: `to` is null between the first tap and the second.
 *
 * Kept separate from `DateRange` on purpose. `DateRange` is a complete span the
 * screen can go and ask the server about; this is a half-finished thought, and
 * the two must not be the same type or an incomplete selection eventually gets
 * sent as `from === to` and quietly answers the wrong question.
 */
export interface Selection {
  from: string;
  to: string | null;
}

export interface RangeCalendarProps {
  value: Selection | null;
  onChange: (next: Selection) => void;
  /** Nothing after this day can be picked. */
  latest: string;
}

/**
 * What a tap on `day` means, given what is already selected.
 *
 * Pure, and exported, because it is the only real logic here: the rest of this
 * file is a grid. Three cases —
 *
 *  - nothing selected, or a complete span: this tap starts a new one;
 *  - one end down, tapped LATER: that closes the span;
 *  - one end down, tapped EARLIER: that closes it too, backwards. A thumb does
 *    not know which end it landed on first, and refusing the tap would leave
 *    somebody pressing a date the calendar simply ignores.
 *
 * A span longer than the server will answer for starts over rather than being
 * clipped — clipping would answer a different question than the one they asked
 * with their two taps, and say nothing about having done so.
 */
export function nextSelection(current: Selection | null, day: string): Selection {
  if (!current || current.to !== null) return { from: day, to: null };

  const [from, to] = day < current.from ? [day, current.from] : [current.from, day];
  if (spanDays(from, to) > MAX_RANGE_DAYS) return { from: day, to: null };
  return { from, to };
}

/** Whether `day` is inside a selection, and if so where. */
function positionIn(day: string, value: Selection | null) {
  if (!value) return null;
  const to = value.to ?? value.from;
  if (day < value.from || day > to) return null;
  if (day === value.from && day === to) return 'only' as const;
  if (day === value.from) return 'start' as const;
  if (day === to) return 'end' as const;
  return 'middle' as const;
}

/**
 * The month grid the Earnings range is picked on.
 *
 * Built rather than installed: every calendar package worth using is either a
 * native module — which breaks Expo Go — or brings its own theme to fight with
 * `semantic.ts`. A month is a grid of numbers and one arrow at either end.
 *
 * Net-new UI. The prototype has no calendar on this screen (it has no period
 * control at all), so the layout and the copy here need sign-off alongside the
 * segmented control that was already net-new.
 */
export function RangeCalendar({ value, onChange, latest }: RangeCalendarProps) {
  const [cursor, setCursor] = useState(() => startOfMonth(value?.from ?? latest));
  const cell = useCellSize();

  const thisMonth = startOfMonth(latest);
  // The future holds no earnings, so a month entirely in it is not worth
  // paging to. `latest` is today in IST.
  const canGoForward = cursor < thisMonth;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text
          // Capped: the heading shares a row with three controls, and a long
          // month at a large text size would push them off it.
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'Roboto_700Bold',
            fontSize: 15,
            color: color.textPrimary,
          }}
        >
          {monthTitle(cursor)}
        </Text>

        {/* Only while it would do something. Paging back a year is twelve taps
            and there is no thirteenth to get home again. */}
        {cursor !== thisMonth ? (
          <Pressable
            onPress={() => setCursor(thisMonth)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go to this month"
          >
            {({ pressed }) => (
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 13,
                  color: color.textLink,
                  paddingHorizontal: 8,
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                Today
              </Text>
            )}
          </Pressable>
        ) : null}

        <MonthStep
          icon="chevronLeft"
          label="Previous month"
          onPress={() => setCursor(addMonths(cursor, -1))}
        />
        <MonthStep
          icon="chevronRight"
          label="Next month"
          disabled={!canGoForward}
          onPress={() => setCursor(addMonths(cursor, 1))}
        />
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_INITIALS.map((initial, i) => (
          <Text
            key={i}
            maxFontSizeMultiplier={1.2}
            style={{
              flex: 1,
              textAlign: 'center',
              paddingVertical: 6,
              fontFamily: 'Roboto_700Bold',
              fontSize: 11,
              color: color.textMuted,
            }}
          >
            {initial}
          </Text>
        ))}
      </View>

      {monthMatrix(cursor).map((week, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {week.map((day, index) => (
            <Day
              key={day ?? `pad-${index}`}
              day={day}
              size={cell}
              at={day ? positionIn(day, value) : null}
              isToday={day === latest}
              disabled={!day || day > latest}
              onPress={() => day && onChange(nextSelection(value, day))}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * How tall a day may be, so a six-row month cannot push the sheet off screen.
 *
 * A square cell sized purely by width is right on any phone tall enough for it
 * — and on a short one it silently overflows the top of a bottom sheet, taking
 * the heading and the helper line with it. `Sheet` does not scroll, so nothing
 * catches that.
 *
 * `SHEET_CHROME` is what surrounds the grid inside the sheet, measured from
 * this component's own callers rather than guessed: the grabber block and the
 * sheet's padding (~33), the title and helper (~64), this header and the
 * weekday row (~65), the two buttons (~118), and the bottom inset with a
 * margin above the status bar (~80). Six rows share what is left.
 */
function useCellSize(): number {
  const { width, height } = useWindowDimensions();
  const SHEET_CHROME = 360;
  const SHEET_PADDING = 44; // 22 each side, from `Sheet`

  const byWidth = (width - SHEET_PADDING) / 7;
  const byHeight = (height - SHEET_CHROME) / 6;
  // The floor keeps a very small or heavily scaled screen legible rather than
  // shrinking the grid into something nobody can hit.
  return Math.max(30, Math.floor(Math.min(byWidth, byHeight)));
}

function MonthStep({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: 'chevronLeft' | 'chevronRight';
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? color.surfaceSunken : 'transparent',
            opacity: disabled ? 0.35 : 1,
          }}
        >
          <Icon name={icon} size={20} color={color.textPrimary} />
        </View>
      )}
    </Pressable>
  );
}

/**
 * One cell.
 *
 * The wash that joins a span is on the CELL and the fill that marks an end is
 * a rounded square inside it, so a range reads as one continuous bar with two
 * solid ends — and a range crossing a row break simply runs to the edge and
 * picks up on the next line, which is what every calendar does and what makes
 * the shape legible without drawing it.
 */
function Day({
  day,
  size,
  at,
  isToday,
  disabled,
  onPress,
}: {
  day: string | null;
  size: number;
  at: ReturnType<typeof positionIn>;
  isToday: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const filled = at === 'start' || at === 'end' || at === 'only';
  const washed = at !== null;

  // Square off the inner edges so the middle of a span is continuous, and round
  // only where the selection actually begins and ends.
  const leftRadius = at === null || at === 'start' || at === 'only' ? 11 : 0;
  const rightRadius = at === null || at === 'end' || at === 'only' ? 11 : 0;

  return (
    <View
      style={{
        // No inset: the wash lives on this cell and the end fill on the view
        // inside it, so any padding here would leave the two different heights
        // and the join between them visibly ragged.
        //
        // `flex: 1` for the width so seven cells always fill the row exactly —
        // a rounded `size` times seven would leave a ragged right edge — and an
        // explicit height, because that is the one the sheet has to fit.
        flex: 1,
        height: size,
        backgroundColor: washed ? color.rangeSpanBg : 'transparent',
        borderTopLeftRadius: leftRadius,
        borderBottomLeftRadius: leftRadius,
        borderTopRightRadius: rightRadius,
        borderBottomRightRadius: rightRadius,
      }}
    >
      {day ? (
        <Pressable
          onPress={disabled ? undefined : onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={formatDay(day, { withYear: true })}
          accessibilityState={{ selected: washed, disabled }}
          style={{ flex: 1 }}
        >
          {({ pressed }) => (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 11,
                backgroundColor: filled
                  ? color.rangeEndBg
                  : pressed
                    ? color.surfaceSunken
                    : 'transparent',
                // Today is ringed only while it is not an end itself — a ring
                // inside a solid fill is noise.
                borderWidth: isToday && !filled ? 1.5 : 0,
                borderColor: color.rangeToday,
              }}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontFamily: filled || isToday ? 'Roboto_700Bold' : 'Roboto_400Regular',
                  fontSize: 13.5,
                  color: disabled
                    ? color.rangeUnavailable
                    : filled
                      ? color.rangeEndFg
                      : washed
                        ? color.rangeSpanFg
                        : color.textPrimary,
                }}
              >
                {Number(day.slice(8))}
              </Text>
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
