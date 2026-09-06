import { BRAND_MARK, BRAND_NAME } from '@/lib/brand';
import { useSession } from '@/store/session.store';

export interface Brand {
  /** What the app calls this workspace. */
  name: string;
  /** The letters in the tile beside it. */
  mark: string;
  /** False when this is the platform's own brand, not a company's. */
  isCompany: boolean;
}

/**
 * Whose app this is.
 *
 * The mobile twin of the console's `useBrand`, and the same rule: the company
 * wherever one is known, the platform only where none can be.
 *
 * A technician belongs to exactly one company, so there is nothing to switch
 * between — the brand is simply their employer's, and it arrives with the
 * session on sign-in. Before that it cannot be known at all: signing in starts
 * from a phone number, and nothing says which company that number belongs to
 * until the code is verified. That is why `LoginScreen` shows the platform
 * mark and is not a gap to be filled.
 *
 * The mark is never derived from the name here. `companies.code` is stamped
 * once and deliberately never recomputed, so a second derivation would
 * eventually draw a different mark from the one on that company's job codes.
 */
export function useBrand(): Brand {
  const technician = useSession((s) => s.technician);

  const name = technician?.companyName;
  const mark = technician?.companyCode;

  // Name and mark move together — the company's name beside the platform's
  // mark is the mismatch this exists to prevent.
  if (!name) return { name: BRAND_NAME, mark: BRAND_MARK, isCompany: false };
  return { name, mark: mark || BRAND_MARK, isCompany: true };
}
