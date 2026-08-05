import { ArrowLeft } from "lucide-react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/LinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ValidationTable } from "@/components/tickets/ValidationTable";
import { useBatch } from "@/hooks/useImports";
import { downloadCsv, toCsv } from "@/utils/csv";
import { cn } from "@/lib/utils";

export default function ValidationResultPage() {
  const { batchId = "" } = useParams();
  const { data, isLoading, isError, error, refetch } = useBatch(batchId);

  const rejectedRows = data?.rows.filter((r) => r.result === "Rejected") ?? [];

  const stats = [
    { label: "Total rows", value: data?.total, tone: "" },
    { label: "Passed · imported", value: data?.passed, tone: "text-ok" },
    { label: "Rejected", value: data?.rejected, tone: "text-danger" },
  ];

  return (
    <>
      <PageMeta
        title="Upload validation"
        description="Row-level import result."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to="/tickets/import"
      >
        <ArrowLeft data-icon="inline-start" />
        Back to upload
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this import"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardContent>
                  <div className="text-xs font-medium text-ink-2">
                    {s.label}
                  </div>
                  {isLoading ? (
                    <Skeleton className="mt-2.5 h-7 w-16" />
                  ) : (
                    <div
                      className={cn(
                        "mt-2.5 text-[28px] leading-none font-semibold tabular-nums",
                        s.tone
                      )}
                    >
                      {s.value}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* No Card around the table — DataTable brings its own card chrome,
              so wrapping it would draw a box inside a box. */}
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
            <h2 className="text-sm font-medium">Row-level result</h2>
            <div className="flex flex-wrap gap-2.5">
              {/* Only the rejected rows — the point is to fix and
                  re-upload them, so passed rows would be noise. */}
              <Button
                variant="outline"
                size="sm"
                disabled={!rejectedRows.length}
                onClick={() =>
                  downloadCsv(
                    `installflow-import-errors-${batchId}.csv`,
                    toCsv(
                      ["row", "customer_name", "pincode", "mobile", "reason"],
                      rejectedRows.map((r) => [
                        r.row,
                        r.customer,
                        r.pincode,
                        r.mobile,
                        r.reason,
                      ])
                    )
                  )
                }
              >
                Download error report
              </Button>
              <LinkButton size="sm" to="/tickets">
                Go to imported tickets
              </LinkButton>
            </div>
          </div>

          <ValidationTable rows={data?.rows} isLoading={isLoading} />
        </>
      )}
    </>
  );
}
