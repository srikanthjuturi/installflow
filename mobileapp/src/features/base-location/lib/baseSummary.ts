import { t } from 'i18next';

import { dayMonthLabel } from '@/utils/date';
import type { BaseLocation, TechnicianSession } from '@/types/domain';

/**
 * Should Home nag about the base?
 *
 * True only for an explicit `null` — a server that knows the field and has
 * none. `undefined` is an API (or a session persisted before it) that predates
 * the field: unknown, never "not set". Nagging against an old server would send
 * a technician to a screen whose save does not exist.
 */
export function needsBaseLocation(
  me: Pick<TechnicianSession, 'baseLocation'> | null | undefined,
): boolean {
  return me != null && me.baseLocation === null;
}

export type BaseSummary =
  | { key: 'baseLocation.current.pincode'; params: { pincode: string } }
  | {
      key:
        | 'baseLocation.current.gps'
        | 'baseLocation.current.map'
        | 'baseLocation.current.byManager'
        | 'baseLocation.current.set';
      params: Record<string, never>;
    };

/** Set by a manager in the console — either way the source says so. */
function byManager(base: BaseLocation): boolean {
  return base.source === 'manual' || base.setBySelf === false;
}

/**
 * How to word a base. Keys, not text: the caller runs `t()` while rendering so
 * a language switch rewords what is already on screen. Any source this build
 * has not heard of reads as plain "Set" rather than breaking the screen.
 */
export function baseSummary(base: BaseLocation): BaseSummary {
  if (byManager(base)) return { key: 'baseLocation.current.byManager', params: {} };
  switch (base.source) {
    case 'pincode':
      return base.pincode
        ? { key: 'baseLocation.current.pincode', params: { pincode: base.pincode } }
        : { key: 'baseLocation.current.set', params: {} };
    case 'gps':
      return { key: 'baseLocation.current.gps', params: {} };
    case 'map':
      return { key: 'baseLocation.current.map', params: {} };
    default:
      return { key: 'baseLocation.current.set', params: {} };
  }
}

/** `baseSummary`, worded. Call while rendering so a language switch rewords it. */
export function baseSummaryText(base: BaseLocation): string {
  const summary = baseSummary(base);
  return summary.key === 'baseLocation.current.pincode'
    ? t(summary.key, summary.params)
    : t(summary.key);
}

/** The Profile row's value: the pincode digits, or a short word. Call while rendering. */
export function baseShortLabel(base: BaseLocation): string {
  if (byManager(base)) return t('baseLocation.short.manager');
  switch (base.source) {
    case 'pincode':
      return base.pincode ?? t('baseLocation.current.set');
    case 'gps':
      return t('baseLocation.short.gps');
    case 'map':
      return t('baseLocation.short.map');
    default:
      return t('baseLocation.current.set');
  }
}

/** "Set 15 Oct" — formatted at render, in the app's language. */
export function baseSetOnLabel(base: BaseLocation): string {
  const date = dayMonthLabel(base.setAt);
  return date ? t('baseLocation.current.setOn', { date }) : t('baseLocation.current.set');
}
