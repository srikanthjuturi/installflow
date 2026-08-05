import { Link } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/utils/money";
import type { Escalation } from "@/types";

/**
 * One escalated ticket. The left border is danger-toned because every row
 * here is a customer holding a confirmed slot that nobody is going to.
 */
export function EscalationCard({ escalation: e }: { escalation: Escalation }) {
  return (
    <Card className="border-l-3 border-l-danger">
      <CardContent className="flex flex-wrap items-center gap-4.5">
        <div className="min-w-50 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to={`/tickets/${e.id}`}
              className="font-mono text-sm font-semibold hover:text-brand-400"
            >
              {e.id}
            </Link>
            <span className="text-xs text-ink-2">
              {e.customer} · {e.product}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            {e.city} · {e.pincode} · Slot {e.slot}
          </p>
          <p className="mt-1.5 text-xs font-medium text-danger">{e.reason}</p>
        </div>

        <div className="px-3.5 text-center">
          <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            Time to slot
          </div>
          <div className="font-mono text-xl font-semibold text-danger">
            {e.left}
          </div>
        </div>

        <div className="px-3.5 text-center">
          <div className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            Bonus pool
          </div>
          <div className="text-lg font-semibold text-ok">{money(e.pool)}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <LinkButton to={`/escalations/${e.id}/bonus`}>
            Add bonus &amp; re-notify
          </LinkButton>
          <LinkButton variant="outline" to={`/escalations/${e.id}/assign`}>
            Assign manually
          </LinkButton>
        </div>
      </CardContent>
    </Card>
  );
}
