import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card, DetailRow } from '@/components/ui';
import { useJob } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import { formatPaise } from '@/utils/money';

export interface JobDetailScreenProps {
  jobId: string;
}

/**
 * Screen 7 — Job detail, unlocked.
 *
 * The counterpart to the masked offer: now that the job is assigned, the
 * technician gets the name, the full address and a working phone number,
 * because they have to physically arrive and be let in.
 */
export function JobDetailScreen({ jobId }: JobDetailScreenProps) {
  const router = useRouter();
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
    <>
      <Header eyebrow={job?.id ?? ''} title="Job details" tone="chrome" />

      <Screen
        variant="chrome"
        footer={
          job && !done ? (
            <View style={{ gap: 10 }}>
              <Button
                label="Start job & capture proof"
                onPress={() => router.push(`/job/${jobId}/proof/capture`)}
              />
              <Button
                label="Cancel this job"
                variant="ghost"
                onPress={() => router.push(`/job/${jobId}/cancel`)}
              />
            </View>
          ) : undefined
        }
      >
        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isPending ? (
          <View style={{ gap: 14, paddingTop: 20 }}>
            <Skeleton width="100%" height={80} rounded={radius.lg} />
            <Skeleton width="100%" height={140} rounded={radius.lg} />
            <Skeleton width="100%" height={140} rounded={radius.lg} />
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: color.slotBg,
                borderRadius: radius.lg,
                padding: 16,
                marginTop: 20,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="geo" size={15} color={color.slotFg} />
                <Text
                  style={{
                    fontFamily: 'Roboto_700Bold',
                    fontSize: 11,
                    letterSpacing: 1.2,
                    color: color.slotFg,
                  }}
                >
                  COMMITTED
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: 'Roboto_900Black',
                  fontSize: 19,
                  color: color.slotFg,
                  marginTop: 6,
                }}
              >
                {job.slot}
              </Text>
            </View>

            <Card style={{ marginTop: 12 }}>
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 11,
                  letterSpacing: 1.2,
                  color: color.textMuted,
                  marginBottom: 10,
                }}
              >
                CUSTOMER
              </Text>

              <Text
                style={{ fontFamily: 'Roboto_900Black', fontSize: 18, color: color.textPrimary }}
              >
                {job.customer ?? job.maskedCustomer}
              </Text>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: color.textSecondary,
                  marginTop: 4,
                }}
              >
                {job.address}, {job.area} — {job.pincode}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <ContactAction icon="bell" label="Call" onPress={call} />
                <ContactAction icon="geo" label="Navigate" onPress={navigate} />
              </View>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 11,
                  letterSpacing: 1.2,
                  color: color.textMuted,
                  marginBottom: 4,
                }}
              >
                PRODUCT TO INSTALL
              </Text>

              <DetailRow label="Model" value={job.model} first />
              <DetailRow label="Category" value={job.category} />
              <DetailRow label="Service" value="Install & demo" />
              <DetailRow label="SLA type" value={job.sla} />
              <DetailRow label="Payout" value={formatPaise(job.payoutPaise)} />
            </Card>
          </>
        )}
      </Screen>
    </>
  );
}

interface ContactActionProps {
  icon: IconName;
  label: string;
  onPress: () => void;
}

function ContactAction({ icon, label, onPress }: ContactActionProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ flex: 1 }}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 46,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.border,
            backgroundColor: color.surfaceSunken,
            opacity: pressed ? 0.7 : 1,
          }}
        >
          <Icon name={icon} size={18} color={color.actionBg} />
          <Text
            style={{ fontFamily: 'Roboto_700Bold', fontSize: 14, color: color.textPrimary }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
