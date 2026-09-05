import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Button, Sheet } from '@/components/ui';
import { isJobRefused, isJobTaken } from '@/features/jobs/api/accept';
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
    // A refusal is a "no" with a reason the technician can act on: the day is
    // full, availability is off, or the job escalated to the ASM while they
    // were reading the card. None of them is a fault, and none of them is
    // fixed by tapping again — so the body is the SERVER's own sentence, which
    // names the specific fix, rather than the generic connection advice that
    // used to swallow all three.
    const refused = isJobRefused(accept.error) ? accept.error : null;
    const soft = taken || refused !== null;

    return (
      <Sheet onDismiss={dismiss}>
        <IconWell
          icon="warn"
          fg={soft ? palette.secondary[500] : color.debit}
          bg={soft ? color.slotBlockBg : color.statusCancelled.bg}
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
            : (refused?.message ??
              'Something went wrong accepting this job. Check your connection and try again.')}
        </Text>

        {/* "Try again" only where trying again could work. A refusal reproduces
            itself on every tap, and a button that does nothing twice is worse
            than one that is not there. */}
        {soft ? (
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
          {/* Two questions, because they commit to different things. With a
              slot the technician is agreeing to an HOUR; without one they are
              agreeing to the job and the hour lands later. Asking "commit to
              this slot?" over a job that has none is a question about something
              that is not on the screen. Second string not yet approved. */}
          {job?.hoursToSlot === null ? 'Take this job?' : 'Commit to this slot?'}
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
        {job?.hoursToSlot === null ? (
          /* NOT approved copy. It has to say something different because the
             approved sentence asserts a fact that is false here — the customer
             has NOT confirmed a time, and telling a technician they are locked
             to one would be locking them to nothing.

             It still says the two things that matter: the job is theirs from
             the moment they tap, and a time is coming that they will be held
             to. Understating the second would be the worse error — they can
             still be charged for cancelling once it arrives. */
          <>
            The customer has not picked a time yet — they have the link. Accepting takes the
            job now; you will be told the time as soon as they choose it, and{' '}
            <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }}>
              cancelling after that carries a penalty
            </Text>
            .
          </>
        ) : (
          <>
            The customer already confirmed{' '}
            <Text style={{ fontFamily: 'Roboto_700Bold', color: color.textPrimary }}>
              {job?.slot ?? 'this slot'}
            </Text>
            . Accepting locks you to that time — cancelling later carries a penalty.
          </>
        )}
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
