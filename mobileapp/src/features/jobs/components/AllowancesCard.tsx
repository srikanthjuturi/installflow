import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Text } from '@/components/ui';
import { speedLines, travelLine, type AllowanceLine } from '@/features/jobs/allowances';
import { color } from '@/theme/semantic';
import type { Job } from '@/types/domain';
import { formatPaise } from '@/utils/money';

/**
 * What this job pays on top of the payout: the travel allowance and the speed
 * terms, both frozen when the technician accepted (Tasks 10/11).
 *
 * Net-new — the prototype has no allowances anywhere. Copy is Task 15's
 * PROPOSED set.
 *
 * Renders NOTHING when there is nothing to say: a job accepted before the
 * allowances existed, an older API, a product with no speed rule. An empty
 * "Allowances" card on every job would be noise. Amounts are the server's,
 * worded through `formatPaise`; nothing is computed here. Employees see it too
 * — they get travel and speed money (T3), only the per-job payout is salary.
 */
export function AllowancesCard({ job }: { job: Pick<Job, 'travel' | 'speed'> }) {
  const { t } = useTranslation();
  const router = useRouter();

  const travel = travelLine(job.travel, formatPaise);
  const speed = speedLines(job.speed, formatPaise);
  if (!travel && speed.length === 0) return null;

  // Rows get an icon; the trailing note is small print, not a row.
  const rows = speed.filter((l) => !l.key.startsWith('jobs.allowances.speedNote'));
  const note = speed.find((l) => l.key.startsWith('jobs.allowances.speedNote'));

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
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 11,
          letterSpacing: 0.88,
          textTransform: 'uppercase',
          color: color.textFootnote,
          marginBottom: 10,
        }}
      >
        {t('jobs.allowances.title')}
      </Text>

      <View style={{ gap: 10 }}>
        {travel ? (
          <View>
            <Row icon="navigation" line={travel} />
            {travel.action === 'setBase' ? (
              <Pressable
                onPress={() => router.push('/base-location')}
                hitSlop={8}
                accessibilityRole="link"
                style={{ alignSelf: 'flex-start', marginTop: 6, marginLeft: 27 }}
              >
                {({ pressed }) => (
                  <Text
                    style={{
                      fontFamily: 'Roboto_700Bold',
                      fontSize: 13.5,
                      color: color.actionBg,
                      opacity: pressed ? 0.6 : 1,
                    }}
                  >
                    {t('jobs.allowances.setBase')}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {rows.map((line) => (
          <Row key={line.key} icon="clock" line={line} />
        ))}
      </View>

      {note ? (
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12,
            lineHeight: 17,
            color: color.textMuted,
            marginTop: 10,
          }}
        >
          {t(note.key)}
        </Text>
      ) : null}
    </View>
  );
}

function Row({ icon, line }: { icon: 'navigation' | 'clock'; line: AllowanceLine }) {
  const { t } = useTranslation();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={17} color={color.textMuted} strokeWidth={1.7} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: 'Roboto_500Medium',
          fontSize: 13.5,
          lineHeight: 19,
          color: color.textPrimary,
        }}
      >
        {t(line.key, line.params)}
      </Text>
    </View>
  );
}
