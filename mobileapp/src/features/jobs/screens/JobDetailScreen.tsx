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
            </Card>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <StatTile label="SLA type" value={job.sla} />
              <StatTile label="Payout" value={formatPaise(job.payoutPaise)} />
            </View>

            <CustomerVerdict job={job} />

            {/* "Cancel this job" is deliberately absent, not hidden.
                `getCancellationPreview` still looks the job up in `mocks/db`
                and throws on a real ticket id, so the button would take a
                technician who wants out of a job to an error screen. Rendering
                it with `display: 'none'` would leave it in the tree and
                reachable by a screen reader; it returns when the cancel slice
                is real, alongside the penalty bands it needs. */}
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
              <Button
                label="Start job & capture proof"
                leadingIcon="play"
                onPress={() => router.push(`/job/${jobId}/proof/capture`)}
              />
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
 * What the customer said when they answered the confirmation link.
 *
 * Only the customer closes a job here, so this is the verdict on the work —
 * and until now it reached nobody: the rating fed the technician's aggregate
 * score and the words went only to the ticket timeline, which the app cannot
 * see. A technician looking at their own 3.8 on Profile had no way to find out
 * what any of it was based on.
 *
 * Renders nothing until they have actually answered. "Awaiting customer" is
 * already said by the CTA area above; an empty review card under it would just
 * be a second way of saying the same thing.
 */
function CustomerVerdict({ job }: { job: Job }) {
  if (!job.customerConfirmedAt) return null;

  const refused = job.customerRefused === true;
  const rating = job.customerRating ?? null;
  const words = job.customerFeedback?.trim();

  return (
    <View
      style={{
        backgroundColor: refused ? color.statusCancelled.bg : color.surfaceRaised,
        borderWidth: 1,
        borderColor: refused ? color.debit : color.border,
        borderRadius: 14,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 11,
          letterSpacing: 0.88,
          textTransform: 'uppercase',
          color: refused ? color.debit : color.textFootnote,
          marginBottom: 10,
        }}
      >
        {refused ? 'Customer says it is not finished' : 'Customer feedback'}
      </Text>

      {/* A refusal leads with the refusal. The score is beside the point when
          the customer's answer was "you have not done it" — and they are not
          asked to rate work they say did not happen. */}
      {!refused ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: words ? 10 : 0 }}>
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 26,
              lineHeight: 28,
              color: color.textPrimary,
            }}
          >
            {/* Null is "confirmed without rating" — a real answer, and not the
                same claim as zero, which would read as the worst score there
                is. Same rule the Profile stat follows. */}
            {rating ?? '—'}
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12.5,
              color: color.textMuted,
            }}
          >
            {rating === null ? 'Confirmed, not rated' : 'out of 5'}
          </Text>
        </View>
      ) : null}

      {words ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13.5,
            lineHeight: 20,
            color: refused ? color.debit : color.textPrimary,
          }}
        >
          “{words}”
        </Text>
      ) : refused ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 13.5,
            lineHeight: 20,
            color: color.debit,
          }}
        >
          They gave no reason. A manager will be in touch.
        </Text>
      ) : null}
    </View>
  );
}
