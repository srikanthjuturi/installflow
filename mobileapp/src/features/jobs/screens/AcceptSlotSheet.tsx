import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Button, Sheet } from '@/components/ui';
import { isJobTaken } from '@/features/jobs/api/accept';
import { useAcceptJob } from '@/features/jobs/hooks/useAcceptJob';
import { useOffer } from '@/features/jobs/hooks/useJobs';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export interface AcceptSlotSheetProps {
  jobId: string;
}

/**
 * The consent gate before a technician is bound to a time.
 *
 * The prototype makes this a deliberate second step rather than a one-tap
 * accept, and that's right: the slot was promised to a customer before any
 * technician saw it, so accepting is a commitment with a money cost attached
 * to backing out. The sheet says exactly that before the tap lands.
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
        <IconWell
          icon="warn"
          fg={taken ? palette.secondary[500] : color.debit}
          bg={taken ? color.slotBlockBg : color.statusCancelled.bg}
        />

        <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary }}>
          {taken ? 'Someone got there first' : "Couldn't accept"}
        </Text>

        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 14,
            lineHeight: 22,
            color: color.textLabel,
            marginTop: 8,
            marginBottom: 20,
          }}
        >
          {taken
            ? 'Another technician accepted this job while you were deciding. It happens — the pool refreshes automatically.'
            : 'Something went wrong accepting this job. Check your connection and try again.'}
        </Text>

        {taken ? (
          <Button label="Back to pool" onPress={() => router.replace('/pool')} />
        ) : (
          <Button label="Try again" onPress={() => accept.mutate()} />
        )}
        <View style={{ marginTop: 6 }}>
          <Button label="Close" variant="ghost" onPress={dismiss} />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet onDismiss={dismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <IconWell icon="clock" fg={palette.secondary[500]} bg={color.slotBlockBg} inline />
        {/* `flex: 1` so a longer heading wraps inside the row rather than
            pushing the well off the edge of the sheet. */}
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 20,
            color: color.textPrimary,
            flex: 1,
          }}
        >
          Commit to this slot?
        </Text>
      </View>

      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 22,
          color: color.textLabel,
          marginTop: 8,
          marginBottom: 16,
        }}
      >
        The customer already confirmed{' '}
        <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }}>
          {job?.slot ?? 'this slot'}
        </Text>
        . Accepting locks you to that time — cancelling later carries a penalty.
      </Text>

      <View
        style={{
          backgroundColor: color.surfaceSunkenAlt,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 16,
          marginBottom: 20,
        }}
      >
        <SummaryRow label="Job" value={job?.model ?? '—'} spaced />
        <SummaryRow label="Area" value={job ? `${job.area} · ${job.pincode}` : '—'} />
      </View>

      <Button
        label="Accept & unlock details"
        loading={accept.isPending}
        onPress={() =>
          accept.mutate(undefined, {
            onSuccess: () => router.replace(`/job/${jobId}`),
          })
        }
      />
      <View style={{ marginTop: 6 }}>
        <Button label="Not now" variant="ghost" onPress={dismiss} disabled={accept.isPending} />
      </View>
    </Sheet>
  );
}

function IconWell({
  icon,
  fg,
  bg,
  inline,
}: {
  icon: IconName;
  fg: string;
  bg: string;
  /** Beside the heading rather than above it — the row owns the spacing. */
  inline?: boolean;
}) {
  return (
    <View
      style={{
        width: 52,
        height: 52,
        borderRadius: 15,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: inline ? 0 : 14,
      }}
    >
      <Icon name={icon} size={26} color={fg} />
    </View>
  );
}

/** No hairlines between rows here — the prototype relies on spacing alone. */
function SummaryRow({ label, value, spaced }: { label: string; value: string; spaced?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: spaced ? 8 : 0,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, color: color.textSecondary }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 13,
          color: color.textPrimary,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
