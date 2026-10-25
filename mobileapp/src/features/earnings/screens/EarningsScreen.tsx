import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar } from '@/components/layout';
import { Text } from '@/components/ui';
import {
  getEarningsSummary,
  listTransactions,
  windowQuery,
} from '@/features/earnings/api/earnings';
import { breakdown } from '@/features/earnings/breakdown';
import { LedgerRow } from '@/features/earnings/components/LedgerRow';
import { useIsEmployee } from '@/features/profile/hooks/useIsEmployee';
import { RedeemCard } from '@/features/redeem/components/RedeemCard';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { errorText } from '@/i18n/errorText';
import { ApiError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useEarningsWindow } from '@/store/earnings.store';
import { color } from '@/theme/semantic';
import {
  EARNINGS_PERIODS,
  type DateRange,
  type EarningsPeriod,
  type EarningsWindow,
} from '@/types/domain';
import {
  formatRange,
  longDayLabel,
  monthYearLabel,
  spanDays,
  weekSpanLabel,
} from '@/utils/date';
import { formatPaise } from '@/utils/money';

/** What each span is called on the control, and under the title. */
const PERIOD_LABEL = {
  day: 'earnings.period.day',
  week: 'earnings.period.week',
  month: 'earnings.period.month',
} as const satisfies Record<EarningsPeriod, string>;

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
function errorMessage(error: unknown, t: TFunction): string {
  const fallback = t('earnings.loadFailed');
  if (error instanceof ApiError && error.code === 'RANGE_TOO_LONG') {
    return errorText(error, fallback);
  }
  return fallback;
}

/** "12 Aug – 2 Sep · 22 days", or just the day when a span is one. */
function rangeCaption({ from, to }: DateRange, t: TFunction): string {
  const days = spanDays(from, to);
  return from === to
    ? formatRange(from, to)
    : `${formatRange(from, to)} · ${t('earnings.days', { count: days })}`;
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
  t: TFunction,
): string {
  if (shown.kind === 'range') return rangeCaption(covered ?? shown.range, t);

  // Periods need no such check. A name is resolved BY the server, so whatever
  // it answered over is by definition what "this week" means — re-deriving the
  // bounds here to compare would be the duplicated calendar logic this whole
  // file exists to avoid.
  const period = shown.period;
  if (period === 'day') return `${t(PERIOD_LABEL[period])} · ${longDayLabel(now.toISOString())}`;
  if (period === 'month') {
    return `${t(PERIOD_LABEL[period])} · ${monthYearLabel(now.toISOString())}`;
  }
  return `${t(PERIOD_LABEL[period])} · ${weekSpanLabel()}`;
}

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
  const { t } = useTranslation();
  const showing = useEarningsWindow((s) => s.window);
  const setShowing = useEarningsWindow((s) => s.setWindow);
  // Task 06. An employee's job pay arrives with their salary, so the caption
  // under the net figure says what the figure is for them instead.
  const employee = useIsEmployee();

  // The query string IS the cache key — see `qk.earningsSummary`. Two windows
  // that ask the server the same thing are the same answer by construction.
  const key = windowQuery(showing);
  // `refetchOnWindowFocus` is off by default (`app/_layout.tsx`) and turned on
  // per query; `useAppStateFocus` maps it to "the app came back from the
  // background", which is the whole life of this screen — somebody closes the
  // app after a job and reopens it later to see whether the money landed.
  // Until now nothing here refetched on that, so a payout written while the
  // phone was in a pocket only appeared once the 30s stale window had passed
  // AND the screen was remounted. The socket's own reconnect covers this too;
  // this is what covers the technician whose socket has not come back.
  const summary = useQuery({
    queryKey: qk.earningsSummary(key),
    queryFn: () => getEarningsSummary(showing),
    refetchOnWindowFocus: true,
  });
  const ledger = useQuery({
    queryKey: qk.transactions(key),
    queryFn: () => listTransactions(showing),
    refetchOnWindowFocus: true,
  });

  // The "incl." parts of the three tiles; empty until a summary has arrived.
  const parts = summary.data ? breakdown(summary.data) : {};

  // The whole `earnings` prefix, not the two queries above: the Redeem card's
  // balance lives under it too, and a pull that updated the totals but left
  // "Redeem ₹…" showing the old figure would be refreshing half the screen.
  // `active` only — every other window cached here is re-asked when opened.
  const queryClient = useQueryClient();
  const pull = usePullToRefresh(() =>
    queryClient.refetchQueries({ queryKey: qk.earnings(), type: 'active' }),
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl {...pull} />}
      >
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
                {t('earnings.title')}
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
                {windowCaption(showing, summary.data?.covered ?? null, new Date(), t)}
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
                {errorMessage(summary.error, t)}
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
                    {t('common.tryAgain')}
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
                {t(employee ? 'earnings.netCaptionEmployee' : 'earnings.netCaption')}
              </Text>

              {/* The three tiles keep the SERVER's figures, which already include
                  travel and speed (index §6a). The "incl." line under each is a
                  part of that figure, never added to it, and absent when the
                  server did not send the breakdown or it is zero. */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <ChromeTile
                  label={t('earnings.earned')}
                  value={formatPaise(summary.data.earnedPaise)}
                  tint={color.creditOnChrome}
                  sub={
                    parts.earned !== undefined
                      ? t('earnings.inclTravel', { amount: formatPaise(parts.earned) })
                      : undefined
                  }
                />
                <ChromeTile
                  label={t('earnings.bonuses')}
                  value={formatPaise(summary.data.bonusesPaise)}
                  tint={color.bonusOnChrome}
                  sub={
                    parts.bonuses !== undefined
                      ? t('earnings.inclSpeed', { amount: formatPaise(parts.bonuses) })
                      : undefined
                  }
                />
                <ChromeTile
                  label={t('earnings.penalties')}
                  value={formatPaise(summary.data.penaltiesPaise)}
                  tint={color.debitOnChrome}
                  sub={
                    parts.penalties !== undefined
                      ? t('earnings.inclSpeedPenalty', { amount: formatPaise(parts.penalties) })
                      : undefined
                  }
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
          {/* Above the ledger rather than inside the hero: the hero is one
              period's net, and this is a different number — everything owed
              and not yet asked for. Side by side on the dark panel they would
              read as the same figure twice. */}
          <RedeemCard />

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
            {t('earnings.transactions')}
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
                title={t('earnings.emptyRangeTitle')}
                body={t('earnings.emptyRangeBody')}
              />
            ) : (
              <EmptyState
                icon="wallet"
                title={t('earnings.emptyTitle')}
                body={t('earnings.emptyBody')}
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
              {ledger.data.map((txn, i) => (
                <LedgerRow
                  key={txn.id}
                  txn={txn}
                  first={i === 0}
                  onOpen={
                    txn.ticketId ? () => router.push(`/job/${txn.ticketId}`) : undefined
                  }
                />
              ))}
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
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('earnings.pickDates')}
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
  const { t } = useTranslation();
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
              // pushing each other off the hero. And shrunk to fit when even
              // that is too wide — Tamil at a large text size is.
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                fontFamily: selected ? 'Roboto_700Bold' : 'Roboto_500Medium',
                fontSize: 13,
                color: selected ? color.textPrimary : color.textOnChrome,
              }}
            >
              {t(PERIOD_LABEL[option])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChromeTile({
  label,
  value,
  tint,
  sub,
}: {
  label: string;
  value: string;
  tint: string;
  /** "incl. ₹70 travel" — a part of `value`, not an addition to it. */
  sub?: string;
}) {
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
      {/* One line, shrunk to fit: the label sits above the figure, so a label
          that wrapped would push one tile's figure below the other two. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textOnChrome }}
      >
        {label}
      </Text>
      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 16, color: tint, marginTop: 2 }}
      >
        {value}
      </Text>
      {sub ? (
        <Text
          numberOfLines={2}
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 11,
            color: color.textOnChrome,
            marginTop: 2,
          }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}
