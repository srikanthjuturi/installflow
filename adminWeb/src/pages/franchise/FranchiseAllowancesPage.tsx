import { PageMeta } from "@/components/shared/PageMeta";
import { AllowancesView } from "@/components/allowances/AllowancesView";
import { useMe } from "@/hooks/useAuth";
import type { AllowanceScope } from "@/types/allowances";

/** Module-level so the scope object is the same reference on every render. */
const SCOPE: AllowanceScope = { kind: "franchise" };

/**
 * Allowance rules — the franchisee admin's own travel and speed settings (Task
 * 13 §5.4). Everything is the franchisee's own: the endpoints are pinned to the
 * principal, so nothing here names a franchisee id, and the server's
 * `franchise.settings` key is what gates the writes (the rail entry and
 * `featureForFranchisePath` hide it from everyone who lacks it).
 *
 * The page renders no heading of its own — `FranchiseShell` draws the `<h1>`
 * from `franchiseRouteMeta`.
 */
export default function FranchiseAllowancesPage() {
  const { data: me } = useMe();

  return (
    <>
      <PageMeta
        title="Allowance rules"
        description="Travel and speed allowances for your technicians"
      />
      <AllowancesView
        scope={SCOPE}
        readOnly={false}
        franchiseeName={me?.franchisee?.name}
      />
    </>
  );
}
