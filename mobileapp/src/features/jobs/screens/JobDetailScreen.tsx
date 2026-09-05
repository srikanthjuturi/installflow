import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { ScreenStatusBar } from '@/components/layout';
import { CATEGORY_ICONS, Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { useCompleteJob } from '@/features/proof/hooks/useProof';
import { color } from '@/theme/semantic';
import type { Job } from '@/types/domain';
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
  const { data: job, isPending, isError, refetch } = useJob(jobId);

  const complete = useCompleteJob(jobId);

  // Three CTA states, from the server's own word rather than the app's coarser
  // five-value one — `In Progress` and `Awaiting Customer` both map to
  // `inprogress`, and they need completely different buttons.
  //
  //   Assigned           → start, which opens proof capture straight away
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
                  backgroundColor: pressed ? color.chromeControl : 'transparent',
                }}
              >
                <Icon name="chevronLeft" size={24} color={color.textInverse} />
              </View>
            )}
          </Pressable>

          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 17, color: color.textInverse }}>
            Job details
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
              Committed · {job.slot}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
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
              <CardLabel>Customer</CardLabel>

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
                  <Button label="Call" variant="outline" leadingIcon="phone" onPress={call} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Navigate"
                    variant="outline"
                    leadingIcon="navigation"
                    onPress={navigate}
                  />
                </View>
              </View>
            </Card>

            <Card>
              <CardLabel spaced>Product to install</CardLabel>

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
                    {job.category} · {job.serviceType}
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
              <StatTile label="SLA type" value={job.sla} />
              <StatTile label="Payout" value={formatPaise(job.payoutPaise)} />
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
                  This job has gone to your Area Service Manager. They will be in
                  touch — there is nothing to do here.
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
                  {linkFailed
                    ? `Work submitted, but we could not message ${job.customer ?? 'the customer'}. Ask them to confirm before you leave, or tell your manager.`
                    : `Work submitted. ${job.customer ?? 'The customer'} has been sent a link to confirm it — the job closes when they do.`}
                </Text>
              </View>
            ) : working ? (
              <>
                <Button
                  label="Complete the job"
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
                      ? complete.error.message
                      : "Couldn't complete this job"}
                  </Text>
                ) : null}
              </>
            ) : !done ? (
              <>
                <Button
                  label="Start job & capture proof"
                  leadingIcon="play"
                  onPress={() => router.push(`/job/${jobId}/proof/capture`)}
                />
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
                      label="Cancel this job"
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
 * "27 Aug, 10:41 AM" — short, because the job's own slot is the date that
 * matters here; this is only how long they took to answer.
 *
 * Pinned to IST like every other time in the app. The device's own zone would
 * be right for a technician standing in India and wrong for anybody testing
 * from anywhere else, which is the worst combination: it looks correct.
 */
function answeredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Five stars filled to the rating.
 *
 * Characters, not icons: this app's icon set is stroked at 1.8 and a rating
 * star has to read as FILLED to be countable at a glance. The console already
 * uses the same glyph, so the two surfaces show one thing one way.
 */
function Stars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={`${rating} out of 5`}>
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
  if (!job.customerConfirmedAt) return null;

  const refused = job.customerRefused === true;
  const rating = job.customerRating;
  const words = job.customerFeedback?.trim();
  const when = answeredAt(job.customerConfirmedAt);
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
          {refused ? 'Not finished, they say' : 'Customer feedback'}
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
            {rating === null ? 'Not rated' : `${rating}.0`}
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
          They gave no reason.
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
          A manager will review this. Do not return to site until they call.
        </Text>
      ) : null}
    </View>
  );
}
