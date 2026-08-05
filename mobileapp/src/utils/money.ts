/**
 * Money is stored as integer paise everywhere and only formatted at the edge.
 * Floats would silently drift on penalty arithmetic (₹150 penalty against a
 * ₹420 payout), and the ledger has to reconcile exactly.
 */

const RUPEE = '₹';

/** 42000 → "₹420" · 42050 → "₹420.50" */
export function formatPaise(paise: number): string {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;

  const grouped = groupIndian(rupees);
  const body = remainder === 0 ? grouped : `${grouped}.${String(remainder).padStart(2, '0')}`;

  return `${paise < 0 ? '−' : ''}${RUPEE}${body}`;
}

/** Ledger amounts carry an explicit sign: "+₹460" / "−₹150". */
export function formatSignedPaise(paise: number): string {
  if (paise < 0) return formatPaise(paise);
  return `+${formatPaise(paise)}`;
}

/**
 * Indian digit grouping — last three digits, then pairs.
 * 1750 → "1,750" · 175000 → "1,75,000"
 */
function groupIndian(value: number): string {
  const s = String(value);
  if (s.length <= 3) return s;

  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}
