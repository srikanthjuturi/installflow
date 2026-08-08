import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSwitchCompany } from "@/hooks/useAuth";
import { useSession } from "@/store/session";

/**
 * Active-company control in the header.
 *
 * - No companies (e.g. superadmin) → nothing.
 * - One company → a static chip naming it.
 * - Two or more → a dropdown to switch. Switching re-scopes the token and
 *   refetches everything for the new company.
 */
export function CompanySwitcher() {
  const memberships = useSession((s) => s.memberships);
  const activeCompanyId = useSession((s) => s.activeCompanyId);
  const switcher = useSwitchCompany();

  if (memberships.length === 0) return null;

  const active =
    memberships.find((m) => m.companyId === activeCompanyId) ?? memberships[0];

  if (memberships.length === 1) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 sm:flex">
        <Building2 className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="max-w-40 truncate">{active.companyName}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={switcher.isPending}
        aria-label={`Active company: ${active.companyName}. Switch company`}
        className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand-400 disabled:opacity-60"
      >
        <Building2 className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="max-w-40 truncate">{active.companyName}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch company</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map((m) => (
            <DropdownMenuItem
              key={m.companyId}
              disabled={switcher.isPending}
              onClick={() => {
                if (m.companyId !== active.companyId)
                  switcher.mutate(m.companyId);
              }}
            >
              <span className="truncate">{m.companyName}</span>
              {m.companyId === active.companyId ? (
                <Check className="ml-auto size-4 text-brand-500" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
