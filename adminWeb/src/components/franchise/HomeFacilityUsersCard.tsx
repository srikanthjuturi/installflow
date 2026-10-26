import { useFeatureAccess, useMe } from "@/hooks/useAuth";
import { homeFacilityUsers } from "@/services/parts";
import type { Franchisee } from "@/types/franchisee";
import { FacilityUsersSection } from "./FacilityUsersSection";

/**
 * The HOME franchisee's *Facility users* — a card on its Franchisees page
 * (owner ruling 2026-10-15, R4; Task 13 §5.7).
 *
 * Spare parts have no Admin / National Head fallback: a franchisee with no
 * active facility user cannot have a part requested (409 `NO_FACILITY`, the
 * app hides *Need a spare part*). The home franchise has no franchisee admin by
 * default to add its first one, so the company's Admin and National Head do it
 * here — through `/spare-parts/home-facility-users`, which names no franchisee
 * (the server resolves the company's home). That is the ONLY way staff touch
 * the parts desk; the answer to "who works the home queue?" is never a staff
 * queue (§8).
 *
 * Shown only on the home franchisee, only to Admin / National Head. RH and AM
 * never see it, and a non-home franchisee's own admins use the portal. The
 * server holds `franchisees.manage` plus a National-Head floor either way —
 * this is presentation.
 *
 * It uses `FacilityUsersSection` over `homeFacilityUsers`, so the table, the
 * add dialog (both roles offered — the viewer outranks both) and the reissue
 * dialog are the portal's own.
 */
export function HomeFacilityUsersCard({
  franchisee,
}: {
  franchisee: Franchisee;
}) {
  const { has } = useFeatureAccess();
  const { data: me } = useMe();
  const role = me?.user.role;

  if (
    !franchisee.isHome ||
    !has("franchisees.manage") ||
    (role !== "admin" && role !== "national_head")
  ) {
    return null;
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1">
      <FacilityUsersSection
        source={homeFacilityUsers}
        bare
        // The header words itself by whether anyone exists (§5.10): a home with
        // no facility user is a home whose technicians cannot request a part,
        // and that is the sentence worth reading. `undefined` (still loading,
        // or a search narrowing the count) reads as "some" — never as "none".
        describe={(total) => (
          <div className="border-b border-line px-3.5 py-3">
            <h3 className="text-[15px] font-semibold text-ink">
              Facility users
            </h3>
            <p className="text-[12px] text-ink-3">
              {total === 0
                ? `${franchisee.name} has no parts store yet — until it has a facility user, its technicians can't request spare parts.`
                : `Who runs ${franchisee.name}'s parts store. They sign in to the franchise portal and see only spare-part requests.`}
            </p>
          </div>
        )}
      />
    </section>
  );
}
