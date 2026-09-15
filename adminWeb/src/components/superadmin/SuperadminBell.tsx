import { useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useWaitingRechargeCount, useWaitingRecharges } from "@/hooks/usePlatform";
import { relativeTime } from "@/lib/relativeTime";
import { moneyPaise } from "@/utils/money";

/**
 * The superadmin's bell — companies that say they have paid for credits.
 *
 * Not the ops console's `NotificationBell`, and it cannot be: that reads the
 * notifications feed, and a notification belongs to a company while a
 * superadmin belongs to none. So this is not a feed with read state at all —
 * it lists the recharges waiting for a decision, straight from the queue, and
 * an item leaves it when it is decided. A work item, not a note.
 *
 * The number is polled (`useWaitingRechargeCount`); the list is fetched only
 * while the menu is open.
 */
export function SuperadminBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = useWaitingRechargeCount();
  const { data: waiting, isLoading } = useWaitingRecharges({ enabled: open });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative rounded-full"
            aria-label={
              count > 0 ? `Payments waiting · ${count}` : "Payments waiting"
            }
          />
        }
      >
        <Bell aria-hidden />
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-accent px-1 text-[10px] leading-none font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        /* The content sizes itself to its trigger by default — a 36px button. */
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        {/* A label must sit inside a group — Base UI's `MenuGroupLabel` throws
            without one, and the whole menu fails to open. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Payments waiting</DropdownMenuLabel>
          {isLoading ? (
            <div className="grid gap-2 px-2 py-1.5">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : !waiting?.length ? (
            <p className="px-2 py-3 text-[13px] text-ink-3">Nothing waiting</p>
          ) : (
            waiting.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onClick={() => navigate(`/recharges/${r.id}`)}
                className="flex-col items-start gap-0.5"
              >
                <span className="text-[13px] font-medium text-ink">
                  {r.companyName} paid {moneyPaise(r.amountPaise)}
                </span>
                <span className="text-xs text-ink-3">
                  <span className="font-mono">{r.code}</span>
                  {r.claimedAt ? ` · ${relativeTime(r.claimedAt)}` : ""}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/recharges")}>
          All recharges
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
