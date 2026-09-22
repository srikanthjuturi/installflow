import i18n, { type ParseKeys, t } from 'i18next';

/**
 * Words the server sends as English text, from sets small and fixed enough to
 * translate here.
 *
 * Each is a closed list in the API: the penalty bands in `core/rules.py`, the
 * service types in `core/service_types.py`, role names in `models/role.py`, and
 * ledger titles in `features/earnings/service.py` and `core/ledger.py`.
 * Anything not in a table — a new band, a reworded title — is shown exactly as
 * sent, because English beats a blank or a wrong guess. In English the
 * server's words are shown untouched: this only ever translates, it never
 * rewrites.
 *
 * Keyed by the English text because, for most of these, that is all the server
 * sends. If one of those files changes its wording, change the table with it.
 */

type Table = Readonly<Record<string, ParseKeys>>;

const PENALTY_BANDS: Table = {
  '> 4h before slot': 'server.penaltyBand.over4h',
  '2–4h before slot': 'server.penaltyBand.from2to4h',
  '< 2h before slot': 'server.penaltyBand.under2h',
  'No-show': 'server.penaltyBand.noShow',
};

const SERVICE_TYPES: Table = {
  'Installation + Demo': 'server.serviceType.installDemo',
  'Tech Visit': 'server.serviceType.techVisit',
  Service: 'server.serviceType.service',
};

/**
 * By label AND by code: a redemption's payer arrives only as `payerLabel`
 * ("National Head"), a payout change's reviewer also as `reviewerRole`
 * (`national_head`). Only the roles that ever pay or review a technician.
 */
const ROLES: Table = {
  Admin: 'server.role.admin',
  admin: 'server.role.admin',
  'National Head': 'server.role.nationalHead',
  national_head: 'server.role.nationalHead',
  'Regional Head': 'server.role.regionalHead',
  regional_head: 'server.role.regionalHead',
  'Area Manager': 'server.role.areaManager',
  area_manager: 'server.role.areaManager',
};

const LEDGER_TITLES: Table = {
  'Reassignment bonus': 'server.ledgerTitle.reassignmentBonus',
  'No-show penalty': 'server.ledgerTitle.noShowPenalty',
  'Late cancellation penalty': 'server.ledgerTitle.lateCancellationPenalty',
};

/** A payout row is "<service> · <model>" — see `ledger.payout_reason`. */
const PAYOUT_PREFIXES: Table = {
  Install: 'server.payoutPrefix.install',
  'Tech Visit': 'server.payoutPrefix.techVisit',
  Service: 'server.payoutPrefix.service',
};

const PAYOUT_SEPARATOR = ' · ';

function isEnglish(): boolean {
  return (i18n.resolvedLanguage ?? i18n.language) === 'en';
}

function translate(table: Table, value: string): string {
  if (isEnglish()) return value;
  const key = table[value];
  return key ? t(key) : value;
}

/** A cancellation's band: "> 4h before slot", "No-show"… */
export function penaltyBandLabel(label: string): string {
  return translate(PENALTY_BANDS, label);
}

/** "Installation + Demo", "Tech Visit" or "Service". */
export function serviceTypeLabel(serviceType: string): string {
  return translate(SERVICE_TYPES, serviceType);
}

/** The manager who pays or reviews: a role label, or a role code. */
export function roleLabel(role: string): string {
  return translate(ROLES, role);
}

/**
 * An Earnings row's title. The model half of a payout ("Install · Sunview 43"")
 * is catalogue data and stays as it is; only the service half is translated.
 */
export function ledgerTitle(title: string): string {
  if (isEnglish()) return title;
  const fixed = LEDGER_TITLES[title];
  if (fixed) return t(fixed);

  const at = title.indexOf(PAYOUT_SEPARATOR);
  const prefix = at > 0 ? PAYOUT_PREFIXES[title.slice(0, at)] : undefined;
  return prefix ? t(prefix) + title.slice(at) : title;
}
