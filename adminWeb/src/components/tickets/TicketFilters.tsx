import { Plus, Search } from "lucide-react"
import { Link } from "react-router"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { TicketStatus } from "@/types"

import { STATUS_CHIPS } from "./statusChips"

interface TicketFiltersProps {
  search: string
  status: TicketStatus | "All"
  onSearch: (value: string) => void
  onStatus: (value: TicketStatus | "All") => void
}

export function TicketFilters({
  search,
  status,
  onSearch,
  onStatus,
}: TicketFiltersProps) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <div className="flex h-10 min-w-55 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by ticket ID, customer, mobile, pincode…"
          aria-label="Search tickets"
          className="w-full border-none bg-transparent text-[13px] text-ink outline-none"
        />
      </div>

      <div
        className="flex flex-wrap gap-2.5"
        role="group"
        aria-label="Filter by status"
      >
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={status === chip}
            onClick={() => onStatus(chip)}
            className={cn(
              "h-10 rounded-md border px-3.25 text-xs font-semibold whitespace-nowrap transition-colors",
              status === chip
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-line bg-surface text-ink-2 hover:border-brand-400 hover:text-ink"
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Base UI composes via `render`, not Radix's `asChild`. */}
      <Button
        className="h-10"
        nativeButton={false}
        render={<Link to="/tickets/new" />}
      >
        <Plus data-icon="inline-start" />
        New ticket
      </Button>
    </div>
  )
}
