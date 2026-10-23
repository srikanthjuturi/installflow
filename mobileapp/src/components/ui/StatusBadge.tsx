import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { jobBadge, type BadgeJob } from '@/components/ui/jobBadge';
import { radius } from '@/theme/spacing';

/**
 * The pill on a job card. The rules live in `jobBadge` (`components/ui/
 * jobBadge.ts`) — a pure file, so Home's and My jobs' cards can share them
 * without rendering anything.
 */
export interface StatusBadgeProps {
  job: BadgeJob;
}

export function StatusBadge({ job }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { label, fg, bg } = jobBadge(job);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        borderRadius: radius.full,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: fg }}>{t(`jobs.status.${label}`)}</Text>
    </View>
  );
}