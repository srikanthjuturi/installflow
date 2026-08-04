import { Text, View } from 'react-native';

import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

export type PillTone = 'primary' | 'secondary' | 'success' | 'danger' | 'neutral';

export interface PillProps {
  label: string;
  tone?: PillTone;
}

/**
 * Small tinted label — job category, SLA, status.
 *
 * Radius 8, not fully rounded: the prototype reserves pill shape (999) for
 * job STATUS, so a squarer corner keeps metadata visually distinct from state
 * at a glance down a list.
 */
const TONE: Record<PillTone, { fg: string; bg: string }> = {
  primary: { fg: color.actionBg, bg: palette.primary[75] },
  secondary: { fg: palette.secondary[600], bg: palette.secondary[100] },
  success: color.statusCompleted,
  danger: color.statusCancelled,
  neutral: { fg: color.textSecondary, bg: color.surfaceSunken },
};

export function Pill({ label, tone = 'primary' }: PillProps) {
  const { fg, bg } = TONE[tone];

  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: fg }}>{label}</Text>
    </View>
  );
}
