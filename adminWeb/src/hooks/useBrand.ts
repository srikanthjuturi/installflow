import { useMe } from "@/hooks/useAuth";
import { BRAND_MARK, BRAND_NAME } from "@/lib/brand";
import { useSession } from "@/store/session";

export interface Brand {
  /** What the chrome calls this workspace. */
  name: string;
  /** The two-or-so letters in the tile beside it. */
  mark: string;
  /** False when this is the platform's own brand, not a company's. */
  isCompany: boolean;
}

/**
 * Whose console this is.
 *
 * **The one place the console decides what brand to wear.** The rail header,
 * the tab title, the page-header fallback and the 404 page all read this, so
 * they cannot disagree with each other — or, more to the point, with the
 * `CompanySwitcher` sitting inches away in the topbar. They did: the rail said
 * "Reliance GreenTech" from a hard-coded string while the switcher beside it
 * said "Twincore Technologies" from the session. Same screen, two answers.
 *
 * Resolution order, and why:
 *
 * 1. `/auth/me`'s `activeCompany` — authoritative and re-fetched after a
 *    company switch, and the only source carrying `code`.
 * 2. The persisted membership for the active company — the SAME row the
 *    switcher renders. It fills the moment before `/auth/me` resolves so the
 *    rail does not flash the platform name on every hard refresh, and it
 *    covers a session persisted before `companyCode` was sent at all.
 * 3. The platform brand — a superadmin genuinely has no company
 *    (`principal.company_id` is None by design), and signed-out surfaces have
 *    no session to read.
 *
 * The mark is never derived from the name here. `companies.code` is stored
 * once and deliberately never recomputed — see `api/app/core/company_code.py`
 * — so guessing initials client-side would draw a different mark from the one
 * printed on that company's ticket codes.
 */
export function useBrand(): Brand {
  const { data: me } = useMe();
  const memberships = useSession((s) => s.memberships);
  const activeCompanyId = useSession((s) => s.activeCompanyId);

  const membership =
    memberships.find((m) => m.companyId === activeCompanyId) ?? memberships[0];

  const name = me?.activeCompany?.name ?? membership?.companyName;
  const mark = me?.activeCompany?.code ?? membership?.companyCode;

  // Name and mark move together. Taking the company's name beside the platform
  // mark would put "RG" next to "Twincore Technologies", which is the exact
  // mismatch this hook exists to remove.
  if (!name) return { name: BRAND_NAME, mark: BRAND_MARK, isCompany: false };
  return { name, mark: mark || BRAND_MARK, isCompany: true };
}
