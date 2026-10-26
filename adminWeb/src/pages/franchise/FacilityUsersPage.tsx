import { FacilityUsersSection } from "@/components/franchise/FacilityUsersSection";
import { PageMeta } from "@/components/shared/PageMeta";
import { franchiseFacilityUsers } from "@/services/facilityUsers";

/**
 * Facility users — `/franchise/facility-users` (Task 13 §5.7).
 *
 * Who approves and logs spare parts for THIS franchisee. A franchisee admin adds
 * both roles; a facility admin only operators (`FacilityUsersSection` reads the
 * viewer's role). `franchise.facility_users` gates the route, the server holds
 * the rank rule, and a facility operator — who lacks the key — is bounced to
 * their landing by the franchise guard.
 *
 * The page renders no heading of its own: `FranchiseShell` draws the `<h1>`
 * from `franchiseRouteMeta`.
 */
export default function FacilityUsersPage() {
  return (
    <>
      <PageMeta
        title="Facility users"
        description="Who approves and logs spare parts"
      />
      <FacilityUsersSection source={franchiseFacilityUsers} />
    </>
  );
}
