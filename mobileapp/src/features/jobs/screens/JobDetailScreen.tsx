import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar } from '@/components/layout';
import { CATEGORY_ICONS, Icon } from '@/components/icons/Icon';
import { Button, Text } from '@/components/ui';
import { jobSla, jobSlot } from '@/features/jobs/format';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useCompleteJob } from '@/features/proof/hooks/useProof';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { errorText } from '@/i18n/errorText';
import { serviceTypeLabel } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';
import type { Job } from '@/types/domain';
import { momentLabel } from '@/utils/date';
import { formatPaise } from '@/utils/money';

export interface JobDetailScreenProps {
  jobId: string;
}

/**
 * Screen 7 — Job detail, unlocked.
 *
 * The counterpart to the masked offer: now that the job is assigned the
 * technician gets the name, the full address and a working number, because
 * they have to physically arrive and be let into someone's home.
 */
export function JobDetailScreen({ jobId }: JobDetailScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: job, isPending, isError, refetch } = useJob(jobId);

  const complete = useCompleteJob(jobId);
  // This is the screen a technician WAITS on — for the customer to pick a
  // time, or to confirm the work. The socket refreshes it when it can; a pull
  // is the answer when they are not sure it has.
  const pull = usePullToRefresh(refetch);

  // Three CTA states, from the server's own word rather than the app's coarser
  // five-value one — `In Progress` and `Awaiting Customer` both map to
  // `inprogress`, and they need completely different buttons.
  //
  //   Assigned           → start, which opens proof capture straight away —
  //                        or, with no time agreed yet, a note saying so
  //   In Progress        → complete, which asks the customer to confirm
  //   Awaiting Customer  → nothing to do; it is their move
  const stage = job?.serverStatus;
  const waiting = stage === 'Awaiting Customer';
  const working = stage === 'In Progress';
  // The customer said the work was NOT finished. The technician gets no button:
  // the person who reported it done is not the person who gets to try again
  // unsupervised, and every endpoint would refuse them anyway.
  const escalated = stage === 'Escalated' || stage === 'AI Review';
  const done = job?.status === 'completed' || job?.status === 'cancelled';
  const linkFailed = job?.feedbackRequestStatus === 'failed';

  const call = () => {
    if (job?.phone) Linking.openURL(`tel:${job.phone.replace(/\s/g, '')}`);
  };

  const navigate = () => {
    if (!job) return;
    const query = encodeURIComponent(`${job.address ?? ''}, ${job.area} ${job.pincode}`);
    // Apple Maps on iOS, Google Maps elsewhere — geo: is unreliable on Android
    // when no map app is set as default.
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${query}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="light" />

      <View
        style={{
          backgroundColor: color.chrome,
          paddingTop: insets.top + 6,
          paddingHorizontal: 16,
          paddingBottom: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44 }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}
          >
            {({ pressed }) => (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? color.chromeControl : 'transparent',
                }}
              >
                <Icon name="chevronLeft" size={24} color={color.textInverse} />
              </View>
            )}
          </Pressable>

          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 17, color: color.textInverse }}>
            {t('jobs.detail.title')}
          </Text>

          {/* `code`, never `id`. This is the screen a technician is looking at
              when they phone the ASM about a job, and RGT-INST-0001 is what ops
              can search for — the UUID is a route param and means nothing to
              anybody. The fallback covers mock rows that predate `code`. */}
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{
              marginLeft: 'auto',
              fontFamily: 'RobotoMono_400Regular',
              fontSize: 12,
              color: color.textOnChromeFaint,
            }}
          >
            {job?.code ?? ''}
          </Text>
        </View>

        {/* The committed slot rides in the header as a compact chip, not a
            body block — by this point it is context the technician carries
            through the whole screen, not something to decide about. */}
        {job ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: 8,
              backgroundColor: color.chromeControl,
              borderRadius: 999,
              paddingVertical: 7,
              paddingHorizontal: 13,
              marginTop: 6,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color.notificationDot,
              }}
            />
            <Text
              style={{
                fontFamily: 'Roboto_700Bold',
                fontSize: 12,
                color: color.pillChromeAmberFg,
              }}
            >
              {/* "Committed" is a promise about a time, so it cannot head a job
                  that has none — the technician is committed to the JOB and is
                  waiting on the customer. Second string not yet approved. */}
              {job.hoursToSlot === null
                ? t('jobs.detail.accepted', { slot: jobSlot(job) })
                : t('jobs.detail.committed', { slot: jobSlot(job) })}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isPending ? (
          <View style={{ gap: 14 }}>
            <Skeleton width="100%" height={190} rounded={18} />
            <Skeleton width="100%" height={120} rounded={18} />
          </View>
        ) : (
          <>
            <Card>
              <CardLabel>{t('jobs.detail.customer')}</CardLabel>

              <Text
                style={{ fontFamily: 'Roboto_900Black', fontSize: 19, color: color.textPrimary }}
              >
                {job.customer ?? job.maskedCustomer}
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 8,
                  marginBottom: 16,
                }}
              >
                <View style={{ marginTop: 1 }}>
                  <Icon name="geo" size={17} color={color.textMuted} strokeWidth={1.7} />
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 13.5,
                    lineHeight: 20,
                    color: color.textLabel,
                  }}
                >
                  {/* Filtered, not interpolated bare: `address` is optional on
                      `Job`, and `{job.address}, ...` rendered the literal
                      "undefined, Kandivali West — 400067" whenever it was
                      absent. The navigate handler above already guarded; this
                      did not. */}
                  {[job.address, job.area].filter(Boolean).join(', ')} — {job.pincode}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t('jobs.detail.call')}
                    variant="outline"
                    leadingIcon="phone"
                    onPress={call}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t('jobs.detail.navigate')}
                    variant="outline"
                    leadingIcon="navigation"
                    onPress={navigate}
                  />
                </View>
              </View>
            </Card>

            <Card>
              <CardLabel spaced>{t('jobs.detail.product')}</CardLabel>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    backgroundColor: color.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name={CATEGORY_ICONS[job.category] ?? 'tv'}
                    size={28}
                    color={color.textLabel}
                    strokeWidth={1.7}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 15.5,
                      lineHeight: 19,
                      color: color.textPrimary,
                    }}
                  >
                    {job.model}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12.5,
                      color: color.textSecondary,
                      marginTop: 3,
                    }}
                  >
                    {/* The real service type, not a hardcoded one. "Tech Visit"
                        and "Service" are equally valid and read very
                        differently to a technician deciding what to bring. */}
                    {job.category} · {serviceTypeLabel(job.serviceType)}
                  </Text>
                </View>
              </View>

              {/* The product's own specs, so the technician knows what they are
                  fitting before they are standing in front of it — panel type,
                  capacity, whatever ops recorded against the model.

                  A two-column row per spec rather than a chip list: these are
                  read as name/value pairs, and a technician glancing at a phone
                  in a stairwell scans a column faster than wrapped chips. */}
              {job.modelParameters.length > 0 ? (
                <View style={{ marginTop: 14, gap: 6 }}>
                  {job.modelParameters.map((spec) => (
                    <View
                      key={spec.name}
                      style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
                    >
                      <Text
                        style={{
                          fontFamily: 'Roboto_400Regular',
                          fontSize: 12.5,
                          color: color.textLabel,
                          width: 104,
                        }}
                      >
                        {spec.name}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          fontFamily: 'Roboto_500Medium',
                          fontSize: 12.5,
                          color: color.textPrimary,
                        }}
                      >
                        {spec.value || '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Prose, so it reads as a sentence rather than a table row. */}
              {job.modelNotes ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: color.textSecondary,
                    marginTop: 12,
                  }}
                >
                  {job.modelNotes}
                </Text>
              ) : null}
            </Card>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <StatTile label={t('jobs.detail.slaType')} value={jobSla(job)} />
              <StatTile label={t('jobs.detail.payout')} value={formatPaise(job.payoutPaise)} />
            </View>

            <CustomerVerdict job={job} />

            {escalated ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: color.dangerSurface,
                  borderWidth: 1,
                  borderColor: color.dangerSurfaceBorder,
                  borderRadius: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 15,
                }}
              >
                <Icon name="warn" size={20} color={color.debit} strokeWidth={1.8} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.debit,
                  }}
                >
                  {t('jobs.detail.escalated')}
                </Text>
              </View>
            ) : waiting ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  backgroundColor: linkFailed
                    ? color.dangerSurface
                    : color.successSurface,
                  borderWidth: 1,
                  borderColor: linkFailed
                    ? color.dangerSurfaceBorder
                    : color.successSurfaceBorder,
                  borderRadius: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 15,
                }}
              >
                <Icon
                  name={linkFailed ? 'warn' : 'check'}
                  size={20}
                  color={linkFailed ? color.debit : color.credit}
                  strokeWidth={1.8}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    lineHeight: 19,
                    color: linkFailed ? color.debit : color.credit,
                  }}
                >
                  {/* Named and unnamed are two whole sentences, never a name
                      spliced into one: "the customer" changes form with its
                      place in the sentence, in English and in every other
                      language. */}
                  {linkFailed
                    ? job.customer
                      ? t('jobs.detail.linkFailedNamed', { name: job.customer })
                      : t('jobs.detail.linkFailed')
                    : job.customer
                      ? t('jobs.detail.linkSentNamed', { name: job.customer })
                      : t('jobs.detail.linkSent')}
                </Text>
              </View>
            ) : working ? (
              <>
                <Button
                  label={t('jobs.detail.complete')}
                  leadingIcon="check"
                  loading={complete.isPending}
                  onPress={() =>
                    complete.mutate(undefined, {
                      onSuccess: () => router.push(`/job/${jobId}/proof/closure`),
                    })
                  }
                />
                {complete.isError ? (
                  <Text
                    style={{
                      fontFamily: 'Roboto_400Regular',
                      fontSize: 12,
                      color: color.debit,
                      textAlign: 'center',
                      marginTop: 8,
                    }}
                  >
                    {complete.error instanceof Error
                      ? errorText(complete.error, t('jobs.detail.completeFailed'))
                      : t('jobs.detail.completeFailed')}
                  </Text>
                ) : null}
              </>
            ) : !done ? (
              <>
                {/* No time agreed, no start. The job can be TAKEN before the
                    customer picks a time, but not begun — the server refuses
                    proof on it (`NO_TIME_AGREED`), and a button that led to
                    four photos and then a refusal would be worse than none.
                    The customer's link, or a manager, lifts it — both go
                    through `move_slot`, whose `job.changed` frame refreshes
                    this screen while the app is open.

                    Net-new copy — the prototype has no slotless job. Approved
                    2026-09-21, together with the server's matching sentence. */}
                {stage === 'Assigned' && job.hoursToSlot === null ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      backgroundColor: color.statusUpcoming.bg,
                      borderRadius: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 15,
                    }}
                  >
                    <Icon
                      name="clock"
                      size={20}
                      color={color.statusUpcoming.fg}
                      strokeWidth={1.8}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: 'Roboto_500Medium',
                        fontSize: 13,
                        lineHeight: 19,
                        color: color.statusUpcoming.fg,
                      }}
                    >
                      {job.customer
                        ? t('jobs.detail.waitingNamed', { name: job.customer })
                        : t('jobs.detail.waiting')}
                    </Text>
                  </View>
                ) : (
                  <Button
                    label={t('jobs.detail.start')}
                    leadingIcon="play"
                    onPress={() => router.push(`/job/${jobId}/proof/capture`)}
                  />
                )}
                {/* Back, and reachable at last. It was deliberately ABSENT
                    rather than hidden while `getCancellationPreview` computed
                    the band on the device — a control that took a technician
                    who wanted out of a job to an error screen would have been
                    worse than none, and `display: 'none'` would have left it
                    in the tree for a screen reader to find.

                    Only while the job is still `Assigned`. Once proof has been
                    captured the technician is on site and the job is In
                    Progress; walking away from that is a different event with
                    different evidence, and the server refuses this one. */}
                {stage === 'Assigned' ? (
                  <View style={{ marginTop: 10 }}>
                    {/* Net-new copy — the prototype has no reschedule
                        anywhere. Approved 2026-09-07; see the header of
                        `RescheduleJobScreen`.

                        ABOVE the cancel button, and that order is the point.
                        The two answer the same moment — the customer cannot do
                        today — and only one of them costs the technician
                        ₹300–₹800. Offering the free, customer-agreed option
                        second would bury it under the one that charges them.

                        `secondary`, so it reads as a real alternative to the
                        blue CTA above without competing with it, and clearly
                        apart from the red one below. Same `Assigned`-only gate
                        as cancelling, for the same reason: past it, proof is
                        captured and the technician is on site.

                        And only once there IS a time. A job accepted before the
                        customer picked one has nothing to move, and the server
                        refuses every reschedule call on it — so the button led
                        straight to an error screen. Absent rather than disabled,
                        for the cancel button's reason above; the header chip
                        already says "Accepted" rather than "Committed". */}
                    {job.hoursToSlot !== null ? (
                      <View style={{ marginBottom: 10 }}>
                        <Button
                          label={t('jobs.detail.reschedule')}
                          variant="secondary"
                          leadingIcon="calendar"
                          onPress={() => router.push(`/job/${jobId}/reschedule`)}
                        />
                      </View>
                    ) : null}

                    {/* Was plain `ghost`, so the destructive action rendered in
                        the same grey as body copy and read as disabled text
                        rather than a control.

                        `dangerOutline` — white with a red border — rather than
                        the `dangerGhost` the prototype draws here (transparent,
                        #c81e1e, 46px at radius 12). A DEVIATION from the
                        approved design, asked for and agreed: a borderless
                        label is a hover affordance, and there is no hover on a
                        phone, so it read as text and not as something to press.
                        Outlined rather than filled deliberately — cancelling
                        costs this technician ₹300–₹800, and it must not
                        out-shout the blue CTA above it. */}
                    <Button
                      label={t('jobs.detail.cancel')}
                      variant="dangerOutline"
                      onPress={() => router.push(`/job/${jobId}/cancel`)}
                    />
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 18,
        padding: 18,
        marginBottom: 14,
      }}
    >
      {children}
    </View>
  );
}

function CardLabel({ children, spaced }: { children: string; spaced?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_700Bold',
        fontSize: 11,
        letterSpacing: 0.88,
        textTransform: 'uppercase',
        color: color.textFootnote,
        marginBottom: spaced ? 12 : 8,
      }}
    >
      {children}
    </Text>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.surfaceRaised,
        borderWidth: 1,
        borderColor: color.border,
        borderRadius: 14,
        paddingVertical: 13,
        paddingHorizontal: 15,
      }}
    >
      <Text
        style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: color.textFootnote }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_900Black',
          fontSize: 15,
          color: color.textPrimary,
          marginTop: 3,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Five stars filled to the rating.
 *
 * Characters, not icons: this app's icon set is stroked at 1.8 and a rating
 * star has to read as FILLED to be countable at a glance. The console already
 * uses the same glyph, so the two surfaces show one thing one way.
 */
function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation();

  return (
    <View
      style={{ flexDirection: 'row', gap: 2 }}
      accessibilityLabel={t('jobs.detail.rating', { rating })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Text
          key={n}
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 19,
            lineHeight: 22,
            color: n <= rating ? color.ratingStar : color.ratingStarEmpty,
          }}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

/**
 * What the customer said when they answered the confirmation link.
 *
 * Only the customer closes a job here, so this is the verdict on the work — and
 * for a long time it reached nobody: the rating fed the technician's aggregate
 * score and the words went only to the ticket timeline, which the app cannot
 * see. A technician looking at their own 3.8 had no way to find out why.
 *
 * Built to be read in one glance and to feel like a person said it: stars
 * before the number, the words set as a quotation rather than a field, and the
 * customer's own name under them. A rating rendered as a data row invites the
 * technician to skim past the one part that tells them what to do differently.
 *
 * Renders nothing until they have actually answered. "Awaiting customer" is
 * already said by the CTA above; an empty card would be a second way of saying
 * the same thing.
 */
function CustomerVerdict({ job }: { job: Job }) {
  const { t } = useTranslation();
  if (!job.customerConfirmedAt) return null;

  const refused = job.customerRefused === true;
  const rating = job.customerRating;
  const words = job.customerFeedback?.trim();
  // "27 Aug, 10:41 AM" — short, because the job's own slot is the date that
  // matters here; this is only how long they took to answer. In IST, like
  // every other time in the app.
  const when = momentLabel(job.customerConfirmedAt);
  const who = job.customer ?? job.maskedCustomer;

  return (
    <View
      style={{
        backgroundColor: refused ? color.dangerSurface : color.surfaceRaised,
        borderWidth: 1,
        borderColor: refused ? color.dangerSurfaceBorder : color.border,
        borderRadius: 16,
        padding: 18,
        marginBottom: 20,
      }}
    >
      {/* Eyebrow, with the moment they answered pushed to the far edge. The
          date is context, not the headline, so it never competes with the
          verdict for the first glance. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: refused ? 12 : 14,
        }}
      >
        {refused ? <Icon name="warn" size={16} color={color.debit} strokeWidth={2} /> : null}
        <Text
          style={{
            flex: 1,
            fontFamily: 'Roboto_700Bold',
            fontSize: 11,
            letterSpacing: 0.88,
            textTransform: 'uppercase',
            color: refused ? color.debit : color.textFootnote,
          }}
        >
          {refused ? t('jobs.detail.notFinished') : t('jobs.detail.feedback')}
        </Text>
        <Text
          style={{ fontFamily: 'Roboto_400Regular', fontSize: 11, color: color.textMuted }}
        >
          {when}
        </Text>
      </View>

      {/* A refusal has no score. The customer is not asked to rate work they
          say did not happen, and a row of empty stars would imply they rated
          it nothing — which is a different, worse claim. */}
      {!refused ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          {rating === null ? null : <Stars rating={rating} />}
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 20,
              lineHeight: 22,
              color: color.textPrimary,
            }}
          >
            {/* Null is "confirmed without rating" — a real answer, and not the
                same claim as zero, which reads as the worst score there is. */}
            {rating === null ? t('jobs.detail.notRated') : `${rating}.0`}
          </Text>
        </View>
      ) : null}

      {words ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {/* A rule rather than quotation marks: the words are the customer's
              and should look it, without a glyph fighting the apostrophes
              inside whatever they typed. */}
          <View
            style={{
              width: 3,
              borderRadius: 2,
              backgroundColor: refused ? color.debit : color.borderStrong,
            }}
          />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Roboto_400Regular',
              fontSize: 14.5,
              lineHeight: 22,
              color: refused ? color.debit : color.textPrimary,
            }}
          >
            {words}
          </Text>
        </View>
      ) : refused ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 21,
            color: color.debit,
          }}
        >
          {t('jobs.detail.noReason')}
        </Text>
      ) : null}

      <Text
        style={{
          fontFamily: 'Roboto_500Medium',
          fontSize: 12,
          color: color.textMuted,
          marginTop: words || refused ? 12 : 0,
        }}
      >
        — {who}
      </Text>

      {refused ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 19,
            color: color.textLabel,
            marginTop: 12,
          }}
        >
          {t('jobs.detail.managerReview')}
        </Text>
      ) : null}
    </View>
  );
}
