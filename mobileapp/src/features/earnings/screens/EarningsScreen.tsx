import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import {
  getEarningsSummary,
  listTransactions,
  windowQuery,
} from '@/features/earnings/api/earnings';
import { ApiError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useEarningsWindow } from '@/store/earnings.store';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import {
  EARNINGS_PERIODS,
  type DateRange,
  type EarningsPeriod,
  type EarningsWindow,
  type TransactionKind,
} from '@/types/domain';
import { formatRange, spanDays } from '@/utils/date';
import { formatPaise, formatSignedPaise } from '@/utils/money';

/** What each span is called on the control, and under the title. */
const PERIOD_LABEL: Record<EarningsPeriod, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
};

/**
 * What went wrong, said usefully.
 *
 * `RANGE_TOO_LONG` is the one failure a technician can DO something about, and
 * the only one this screen can produce by asking rather than by the network:
 * the calendar caps a selection at `MAX_RANGE_DAYS`, so seeing this at all
 * means the phone's copy of that limit and the server's have drifted apart.
 * Naming it is what keeps that drift loud instead of showing "check your
 * connection" to somebody whose connection is fine.
 */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'RANGE_TOO_LONG') return error.message;
  return "We couldn't load these earnings. Check your connection and try again.";
}

/** "12 Aug – 2 Sep · 22 days", or just the day when a span is one. */
function rangeCaption({ from, to }: DateRange): string {
  const days = spanDays(from, to);
  return from === to ? formatRange(from, to) : `${formatRange(from, to)} · ${days} days`;
}

/**
 * The line under the heading. Spells the span out rather than naming it twice:
 * the control above already says "This week", so this says which week.
 *
 * A picked range says itself — there is no name above it to avoid repeating —
 * so it carries the dates and how many days they cover.
 *
 * `covered` is the span the SERVER says it answered over, once a response has
 * arrived, and it wins for a range. That is the whole guard against a label
 * that belongs to a different question than the figures beside it: a build that
 * asks for dates against a server which has not learned `dateFrom` yet gets the
 * week back, and this then says "This week" rather than the dates nobody
 * answered. It costs one comparison and removes an entire class of quietly
 * wrong money.
 */
function windowCaption(
  shown: EarningsWindow,
  covered: DateRange | null,
  now: Date,
): string {
  if (shown.kind === 'range') return rangeCaption(covered ?? shown.range);

  // Periods need no such check. A name is resolved BY the server, so whatever
  // it answered over is by definition what "this week" means — re-deriving the
  // bounds here to compare would be the duplicated calendar logic this whole
  // file exists to avoid.
  const period = shown.period;
  if (period === 'day') {
    return `${PERIOD_LABEL[period]} · ${now.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    })}`;
  }
  if (period === 'month') {
    return `${PERIOD_LABEL[period]} · ${now.toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })}`;
  }
  return `${PERIOD_LABEL[period]} · Mon–Sun`;
}

/** Each ledger kind gets its own icon and tint — a penalty must never skim as a payout. */
const KIND_STYLE: Record<TransactionKind, { icon: IconName; fg: string; bg: string }> = {
  payout: { icon: 'card', fg: color.statusCompleted.fg, bg: color.statusCompleted.bg },
  bonus: { icon: 'gift', fg: palette.secondary[600], bg: palette.secondary[100] },
  penalty: { icon: 'warn', fg: color.statusCancelled.fg, bg: color.statusCancelled.bg },
};

/**
 * Screen 15 — Earnings.
 *
 * The whole summary lives in the dark hero: the net figure at 38px with the
 * three components beneath it. Leading with NET, after penalties, is the
 * point — gross would be the flattering number and the wrong one in a week
 * where a late cancellation took money back out.
 */
export function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showing = useEarningsWindow((s) => s.window);
  const setShowing = useEarningsWindow((s) => s.setWindow);

  // The query string IS the cache key — see `qk.earningsSummary`. Two windows
  // that ask the server the same thing are the same answer by construction.
  const key = windowQuery(showing);
  const summary = useQuery({
    queryKey: qk.earningsSummary(key),
    queryFn: () => getEarningsSummary(showing),
  });
  const ledger = useQuery({
    queryKey: qk.transactions(key),
    queryFn: () => listTransactions(showing),
  });

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={{
            backgroundColor: color.chrome,
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: 22,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {/* minWidth 0 so a long range caption ellipsises instead of
                shouldering the calendar button off the row. */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textInverse }}
              >
                Earnings
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textOnChrome,
                  marginTop: 2,
                }}
              >
                {windowCaption(showing, summary.data?.covered ?? null, new Date())}
              </Text>
            </View>

            <DatesButton
              active={showing.kind === 'range'}
              onPress={() => router.push('/earnings-dates')}
            />
          </View>

          <PeriodPicker
            shown={showing}
            onPeriod={(period) => setShowing({ kind: 'period', period })}
          />

          {summary.isError ? (
            /* The hero used to sit on skeletons forever when this failed, which
               reads as a screen still loading rather than one that gave up. */
            <View style={{ marginTop: 16 }}>
              <Text
                style={{
                  fontFamily: 'Roboto_500Medium',
                  fontSize: 13,
                  lineHeight: 19,
                  color: color.textOnChrome,
                }}
              >
                {errorMessage(summary.error)}
              </Text>
              <Pressable
                onPress={() => summary.refetch()}
                hitSlop={8}
                accessibilityRole="button"
                style={{ alignSelf: 'flex-start', marginTop: 10 }}
              >
                {({ pressed }) => (
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 13.5,
                      color: color.pillChromeFg,
                      opacity: pressed ? 0.6 : 1,
                    }}
                  >
                    Try again
                  </Text>
                )}
              </Pressable>
            </View>
          ) : summary.data ? (
            <>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 38,
                  letterSpacing: -0.8,
                  color: color.textInverse,
                  marginTop: 16,
                }}
              >
                {formatPaise(summary.data.netPaise)}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 12.5,
                  color: color.textOnChrome,
                }}
              >
                Net payout after penalties
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <ChromeTile
                  label="Earned"
                  value={formatPaise(summary.data.earnedPaise)}
                  tint={color.creditOnChrome}
                />
                <ChromeTile
                  label="Bonuses"
                  value={formatPaise(summary.data.bonusesPaise)}
                  tint={color.bonusOnChrome}
                />
                <ChromeTile
                  label="Penalties"
                  value={formatPaise(summary.data.penaltiesPaise)}
                  tint={color.debitOnChrome}
                />
              </View>
            </>
          ) : (
            <View style={{ marginTop: 16, gap: 10 }}>
              <Skeleton width={180} height={40} />
              <Skeleton width="100%" height={60} rounded={12} />
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text
            style={{
              fontFamily: 'Roboto_700Bold',
              fontSize: 12,
              color: color.textLabel,
              marginTop: 2,
              marginHorizontal: 4,
              marginBottom: 10,
            }}
          >
            Transactions
          </Text>

          {ledger.isPending ? (
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 16,
                padding: 15,
                gap: 20,
              }}
            >
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width={60} height={14} />
                </View>
              ))}
            </View>
          ) : ledger.isError ? (
            <ErrorState onRetry={() => ledger.refetch()} />
          ) : ledger.data.length === 0 ? (
            /* The approved body is back. It was replaced while nothing priced
               an install — promising that finishing work would show up here
               would have contradicted the hero directly above it — and payouts
               now land in this list, so it is true again. */
            /* "Yet" is about a period still running, so a span they picked out
               of the past needs its own line — otherwise picking 12–15 August
               reports that nothing has happened there so far. */
            showing.kind === 'range' ? (
              <EmptyState
                icon="wallet"
                title="No transactions in these dates"
                body="Nothing was credited or charged over this span."
              />
            ) : (
              <EmptyState
                icon="wallet"
                title="No transactions yet"
                body="Completed jobs will appear here."
              />
            )
          ) : (
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderWidth: 1,
                borderColor: color.border,
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {ledger.data.map((txn, i) => {
                const style = KIND_STYLE[txn.kind];

                return (
                  <View
                    key={txn.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      paddingHorizontal: 15,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: palette.neutral[100],
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 11,
                        backgroundColor: style.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={style.icon} size={20} color={style.fg} />
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          fontFamily: 'Roboto_700Bold',
                          fontSize: 14,
                          color: color.textPrimary,
                        }}
                        numberOfLines={1}
                      >
                        {txn.title}
                      </Text>
                      <Text
                        style={{
                          fontFamily: 'Roboto_400Regular',
                          fontSize: 11.5,
                          color: color.textMuted,
                        }}
                      >
                        {txn.subtitle}
                      </Text>
                    </View>

                    <Text
                      style={{ fontFamily: 'Roboto_900Black', fontSize: 15, color: style.fg }}
                    >
                      {formatSignedPaise(txn.amountPaise)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * "Any other dates", at the end of the title row.
 *
 * Out on its own rather than as a fourth segment, and the size is the argument:
 * a 44px control with a 24px glyph beside the heading is a thumb target a
 * technician can hit in gloves, where a fourth slot in the segmented control
 * was a 17px icon in whatever width three words left over.
 *
 * Filled while a picked range is what the screen is showing — with none of the
 * three segments below lit, this button is the only thing on the hero saying
 * where the figures came from, so it has to carry that state visibly.
 */
function DatesButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Pick dates"
      accessibilityState={{ selected: active }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active
              ? color.surfaceRaised
              : pressed
                ? color.chromeControl
                : color.chromePanel,
          }}
        >
          <Icon
            name="calendar"
            size={24}
            color={active ? color.textPrimary : color.textInverse}
          />
        </View>
      )}
    </Pressable>
  );
}

/**
 * Day / week / month, as a segmented control on the dark hero.
 *
 * Net-new — the prototype has no period control on this screen, so the three
 * words and the shape are new and need sign-off. Segmented rather than a
 * dropdown because there are exactly three, they never grow, and a technician
 * comparing "today" against "this week" should be able to do it with one thumb
 * rather than two taps and a sheet. Anything else they want is the calendar
 * above, which is why a fourth segment was never the answer.
 *
 * All three read unselected while a picked range is showing. That is correct
 * rather than a gap: none of them IS what the screen is showing, and the
 * caption and the lit calendar button both say what is.
 *
 * `accessibilityRole="tab"` with `selected` carries the state, so the fill is
 * never the only thing saying which is chosen.
 */
function PeriodPicker({
  shown,
  onPeriod,
}: {
  shown: EarningsWindow;
  onPeriod: (next: EarningsPeriod) => void;
}) {
  const ranged = shown.kind === 'range';

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: color.chromePanel,
        borderRadius: 11,
        padding: 3,
        marginTop: 14,
        gap: 3,
      }}
    >
      {EARNINGS_PERIODS.map((option) => {
        const selected = !ranged && option === shown.period;

        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onPeriod(option)}
            style={{
              flex: 1,
              borderRadius: 9,
              paddingVertical: 8,
              alignItems: 'center',
              backgroundColor: selected ? color.surfaceRaised : 'transparent',
            }}
          >
            <Text
              // Capped: three fixed words in a row that cannot wrap without
              // pushing each other off the hero.
              maxFontSizeMultiplier={1.3}
              style={{
                fontFamily: selected ? 'Roboto_700Bold' : 'Roboto_500Medium',
                fontSize: 13,
                color: selected ? color.textPrimary : color.textOnChrome,
              }}
            >
              {PERIOD_LABEL[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChromeTile({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.chromePanel,
        borderRadius: 12,
        paddingVertical: 11,
        paddingHorizontal: 13,
      }}
    >
      <Text
        style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textOnChrome }}
      >
        {label}
      </Text>
      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: tint, marginTop: 2 }}
      >
        {value}
      </Text>
    </View>
  );
}
