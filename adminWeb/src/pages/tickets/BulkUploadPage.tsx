import { useNavigate } from "react-router";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardDescription } from "@/components/ui/card";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { UploadDropzone } from "@/components/tickets/UploadDropzone";
import { useUploadBatch } from "@/hooks/useImports";
import { downloadCsv, toCsv } from "@/utils/csv";
import { REQUIRED_COLUMNS } from "@/types";

export default function BulkUploadPage() {
  const navigate = useNavigate();
  const upload = useUploadBatch();

  return (
    <>
      <PageMeta
        title="Excel bulk upload"
        description="Template-based bulk ticket import with row-level validation."
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader className="border-b border-line-2 pb-4">
            <CardTitle className="text-sm">Upload ticket file</CardTitle>
            <CardDescription className="text-xs">
              Use the defined template. Each row is validated individually on
              import.
            </CardDescription>
            <CardAction>
              {/* The template is the 8 required column headers plus one
                  example row, so an ops user can see the expected format
                  rather than guess it. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    "installflow-ticket-template.csv",
                    toCsv(
                      [...REQUIRED_COLUMNS],
                      [
                        [
                          "Videocon",
                          "Television",
                          "Anil Deshmukh",
                          "+91 98220 41120",
                          "411014",
                          "2026-08-10",
                          '43" 4K UHD',
                          "24h",
                        ],
                      ]
                    )
                  )
                }
              >
                <Download data-icon="inline-start" />
                Download template
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent>
            {upload.isError ? (
              <ErrorState
                title="Upload failed"
                error={upload.error}
                onRetry={() => upload.reset()}
              />
            ) : (
              <UploadDropzone
                isUploading={upload.isPending}
                onFile={(file) =>
                  upload.mutate(file, {
                    onSuccess: (batch) =>
                      navigate(`/tickets/import/${batch.id}`),
                  })
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-line-2 pb-4">
            <CardTitle className="text-sm">Required columns</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {REQUIRED_COLUMNS.map((c) => (
                <li
                  key={c}
                  className="rounded-sm bg-surface-3 px-2 py-1 font-mono text-[11px] text-ink-2"
                >
                  {c}
                </li>
              ))}
            </ul>
            {/* The rule that makes bulk intake usable at all. */}
            <p className="mt-3.5 text-xs leading-relaxed text-ink-2">
              Rows missing required fields, with invalid pincodes, or malformed
              phone numbers are rejected individually — the rest of the file
              still imports.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
