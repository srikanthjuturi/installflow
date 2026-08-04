import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, Skeleton } from '@/components/feedback';
import { CATEGORY_ICONS, Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
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

  const done = job?.status === 'completed';

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
      <StatusBar style="light" />

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

          <Text
            style={{
              marginLeft: 'auto',
              fontFamily: 'RobotoMono_400Regular',
              fontSize: 12,
              color: color.textOnChromeFaint,
            }}
          >
            {job?.id ?? ''}
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
                  {job.address}, {job.area} — {job.pincode}
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
                    {job.category} · Install &amp; demo
                  </Text>
                </View>
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <StatTile label="SLA type" value={job.sla} />
              <StatTile label="Payout" value={formatPaise(job.payoutPaise)} />
            </View>

            {!done ? (
              <>
                <Button
                  label="Start job & capture proof"
                  leadingIcon="play"
                  onPress={() => router.push(`/job/${jobId}/proof/capture`)}
                />
                <View style={{ marginTop: 12 }}>
                  <Button
                    label="Cancel this job"
                    variant="dangerGhost"
                    onPress={() => router.push(`/job/${jobId}/cancel`)}
                  />
                </View>
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
