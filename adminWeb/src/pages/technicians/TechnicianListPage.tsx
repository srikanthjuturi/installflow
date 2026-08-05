import { useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { PageMeta } from "@/components/shared/PageMeta";
import { TechTable } from "@/components/technicians/TechTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTechnicians } from "@/hooks/useTechnicians";

const ALL = "All";

export default function TechnicianListPage() {
  // Filters live in the query string so a filtered view is shareable and
  // survives the back button.
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const category = params.get("cat") ?? "";

  const set = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // The unfiltered list supplies the category options. When no category is
  // picked both hooks resolve the same query key, so this costs one request.
  const { data: all } = useTechnicians();
  const { data, isLoading, isError, error, refetch } = useTechnicians(category || undefined);

  const categories = useMemo(
    () => [...new Set((all ?? []).flatMap((t) => t.cats))].sort(),
    [all],
  );

  // Search is client-side: name, technician ID and service pincodes.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data?.filter((t) =>
      [t.name, t.id, t.pincodes].some((field) => field.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const isFiltered = search.trim() !== "" || category !== "";

  return (
    <>
      <PageMeta
        title="Technicians"
        description="Technician master list — categories, pincodes, bandwidth and cancellations."
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="border-line bg-surface flex h-10 min-w-55 flex-1 items-center gap-2 rounded-md border px-3">
          <Search className="text-ink-3 size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search technicians by name, ID, pincode…"
            aria-label="Search technicians"
            className="text-ink w-full border-none bg-transparent text-[13px] outline-none"
          />
        </div>

        <Select
          value={category}
          onValueChange={(v) => set("cat", v === ALL ? "" : String(v))}
        >
          <SelectTrigger className="h-10" aria-label="Filter by category">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>{ALL}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* No onboarding form is designed yet, so the action is present and
            deliberately inert rather than invented. */}
        <Button className="h-10" disabled>
          <Plus data-icon="inline-start" />
          Add technician
        </Button>
      </div>

      <Card>
        <CardContent className="px-0 pb-0">
          <div className="border-line-2 text-ink-2 flex items-center justify-between border-b px-4 pb-3 text-xs">
            <span aria-live="polite">
              Showing <b className="text-ink">{isLoading ? "…" : (rows?.length ?? 0)}</b>{" "}
              technicians
            </span>
          </div>

          <TechTable
            technicians={rows}
            isLoading={isLoading}
            error={isError ? error : null}
            isFiltered={isFiltered}
            onRetry={() => refetch()}
            onClearFilters={() => setParams({}, { replace: true })}
          />
        </CardContent>
      </Card>
    </>
  );
}
