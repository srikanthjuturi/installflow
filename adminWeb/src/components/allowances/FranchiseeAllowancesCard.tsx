import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/hooks/useAuth";
import type { Franchisee } from "@/types/franchisee";
import { AllowancesView } from "./AllowancesView";

/**
 * The **Allowances** card on a franchisee's page (Task 13 §5.4).
 *
 * Admin and National Head only: the API 404s the speed read for anyone lower,
 * and a 404 would toast, so the card is not drawn for them at all (Regional
 * Heads and Area Managers read the rules where they are edited, Configuration →
 * Allowances, for the home franchisee). It never edits here:
 *
 *   - a NON-home franchisee's rules are its own franchise admins' to change, so
 *     this is a read-only window onto them;
 *   - the HOME franchisee's are edited under Configuration → Allowances, so the
 *     card says so, and links there, rather than drawing a second editor.
 */
export function FranchiseeAllowancesCard({
  franchisee,
}: {
  franchisee: Pick<Franchisee, "id" | "name" | "isHome">;
}) {
  const { data: me } = useMe();
  if (me?.role !== "admin" && me?.role !== "national_head") return null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-[15px]">Allowances</CardTitle>
      </CardHeader>
      <CardContent>
        {franchisee.isHome ? (
          <p className="text-[13px] text-ink-2">
            Edited under{" "}
            <Link
              to="/settings/allowances"
              className="font-semibold text-brand-400 hover:underline"
            >
              Configuration → Allowances
            </Link>
          </p>
        ) : (
          <AllowancesView
            scope={{ kind: "franchisee", franchiseeId: franchisee.id }}
            readOnly
            franchiseeName={franchisee.name}
          />
        )}
      </CardContent>
    </Card>
  );
}
