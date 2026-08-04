import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Button, DetailRow, Sheet } from '@/components/ui';
import { isJobTaken } from '@/features/jobs/api/accept';
import { useAcceptJob } from '@/features/jobs/hooks/useAcceptJob';
import { useOffer } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface AcceptSlotSheetProps {
  jobId: string;
}

/**
 * The consent gate before a technician is bound to a time.
 *
 * The prototype makes this a deliberate second step rather than a one-tap
 * accept, and that's right: the slot was promised to a customer before any
 * technician saw it, so accepting is a commitment with a money cost attached
 * to backing out. The sheet says that in as many words.
 */
export function AcceptSlotSheet({ jobId }: AcceptSlotSheetProps) {
  const router = useRouter();
  const { data: job } = useOffer(jobId);
  const accept = useAcceptJob(jobId);

  const dismiss = () => router.back();

  if (accept.isError) {
    const taken = isJobTaken(accept.error);

    return (
      <Sheet onDismiss={dismiss}>
        <View style={{ alignItems: 'center', paddingBottom: 8 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.full,
              backgroundColor: taken ? color.slotBg : color.statusCancelled.bg,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <Icon name="warn" size={24} color={taken ? color.slotFg : color.debit} />
          </View>

          <Text
            style={{ fontFamily: 'Roboto_900Black', fontSize: 19, color: color.textPrimary }}
          >
            {taken ? 'Someone got there first' : "Couldn't accept"}
          </Text>

          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
              textAlign: 'center',
              marginTop: 6,
              marginBottom: 20,
            }}
          >
            {taken
              ? 'Another technician accepted this job while you were deciding. It happens — the pool refreshes automatically.'
              : 'Something went wrong accepting this job. Check your connection and try again.'}
          </Text>

          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            {taken ? (
              <Button label="Back to pool" onPress={() => router.replace('/pool')} />
            ) : (
              <Button label="Try again" onPress={() => accept.mutate()} />
            )}
            <Button label="Close" variant="ghost" onPress={dismiss} />
          </View>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet onDismiss={dismiss}>
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary }}>
        Commit to this slot?
      </Text>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13.5,
          lineHeight: 20,
          color: color.textSecondary,
          marginTop: 8,
          marginBottom: 16,
        }}
      >
        The customer already confirmed{' '}
        <Text style={{ fontFamily: 'Roboto_700Bold', color: color.slotFg }}>
          {job?.slot ?? 'this slot'}
        </Text>
        . Accepting locks you to that time — cancelling later carries a penalty.
      </Text>

      <View
        style={{
          backgroundColor: color.surfaceSunken,
          borderRadius: radius.md,
          paddingHorizontal: 14,
          marginBottom: 20,
        }}
      >
        <DetailRow label="Job" value={job?.model ?? '—'} first />
        <DetailRow label="Area" value={job ? `${job.area} · ${job.pincode}` : '—'} />
      </View>

      <View style={{ gap: 10 }}>
        <Button
          label="Accept & unlock details"
          loading={accept.isPending}
          onPress={() =>
            accept.mutate(undefined, {
              onSuccess: () => router.replace(`/job/${jobId}`),
            })
          }
        />
        <Button label="Not now" variant="ghost" onPress={dismiss} disabled={accept.isPending} />
      </View>
    </Sheet>
  );
}
