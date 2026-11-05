import type { PartsAddress } from '@/features/parts-address/api/partsAddress';

/**
 * One line for a saved address: "12 MG Road, near Metro, Hyderabad 500001".
 * Pure — no `t()` — so it is the same in every language.
 */
export function formatPartsAddress(address: PartsAddress): string {
  const landmark = address.landmark?.trim();
  const parts = [
    address.line.trim(),
    landmark ? `near ${landmark}` : '',
    `${address.city.trim()} ${address.pincode.trim()}`.trim(),
  ];
  return parts.filter(Boolean).join(', ');
}
