import { TransactionsView } from "@/components/transactions/TransactionsView";
import { transactionSurfaceOf } from "@/components/transactions/surface";
import { useSession } from "@/store/session";

/**
 * One route component for all four Transactions routes - the surface is read
 * from the session, the same flags `landingPath` ranks, so the page can never
 * disagree with the shell it is mounted in.
 */
export default function TransactionsPage() {
  const superadmin = useSession((s) => s.superadmin);
  const franchise = useSession((s) => s.franchise);
  const portal = useSession((s) => s.portal);
  return (
    <TransactionsView
      surface={transactionSurfaceOf({ superadmin, franchise, portal })}
    />
  );
}
