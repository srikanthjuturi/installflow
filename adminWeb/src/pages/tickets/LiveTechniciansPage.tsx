import { LiveTechniciansView } from "@/components/tickets/LiveTechniciansView";
import { transactionSurfaceOf } from "@/components/transactions/surface";
import { useSession } from "@/store/session";

/** One route component for all four Live technicians routes - the surface is
 *  read from the session, as `TransactionsPage` does. */
export default function LiveTechniciansPage() {
  const superadmin = useSession((s) => s.superadmin);
  const franchise = useSession((s) => s.franchise);
  const portal = useSession((s) => s.portal);
  return (
    <LiveTechniciansView
      surface={transactionSurfaceOf({ superadmin, franchise, portal })}
    />
  );
}
