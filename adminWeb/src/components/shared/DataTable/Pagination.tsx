import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  sizes: number[];
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  tableId: string;
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  sizes,
  total,
  onPage,
  onPageSize,
  tableId,
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-4 py-3 text-xs text-ink-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${tableId}-size`} className="whitespace-nowrap">
          Rows per page
        </label>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSize(Number(v))}
        >
          <SelectTrigger id={`${tableId}-size`} size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sizes.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* Announced on change so a screen-reader user learns the result count
          without hunting for it. */}
      <span aria-live="polite">
        {total === 0 ? (
          "No rows"
        ) : (
          <>
            Showing <b className="text-ink">{from}</b>–
            <b className="text-ink">{to}</b> of{" "}
            <b className="text-ink">{total}</b>
          </>
        )}
      </span>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous page"
          aria-controls={tableId}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span className="whitespace-nowrap">
          Page <b className="text-ink">{page}</b> of{" "}
          <b className="text-ink">{pageCount}</b>
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next page"
          aria-controls={tableId}
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
