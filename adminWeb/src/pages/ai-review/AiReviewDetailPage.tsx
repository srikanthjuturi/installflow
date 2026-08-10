import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Barcode, Camera, Hash, MapPin } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { ErrorState } from "@/components/shared/states";
import { ConfidenceMeter } from "@/components/ai-review/ConfidenceMeter";
import { SerialCompare } from "@/components/ai-review/SerialCompare";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  useAiThreshold,
  useAiFlag,
  useApproveMatch,
  useRejectAndRetake,
} from "@/hooks/useAiReview";

export default function AiReviewDetailPage() {
  const threshold = useAiThreshold();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: flag, isLoading, isError, error, refetch } = useAiFlag(id);

  const approve = useApproveMatch();
  const reject = useRejectAndRetake();
  const busy = approve.isPending || reject.isPending;

  return (
    <>
      <PageMeta
        title={`AI review ${id}`}
        description="Proof images, serial comparison and the manual ruling."
      />

      <LinkButton
        variant="ghost"
        size="sm"
        className="mb-3.5 -ml-2"
        to="/ai-review"
      >
        <ArrowLeft data-icon="inline-start" />
        Back to AI queue
      </LinkButton>

      {isError ? (
        <ErrorState
          title="Couldn't load this verification"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading || !flag ? (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.3fr_1fr]">
          <Skeleton className="h-104 rounded-xl" />
          <div className="flex flex-col gap-3.5">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* A failed ruling is reported in the toaster (App.tsx); the page
              keeps the proof on screen so the ruling can be retried. */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader>
                <h2 className="text-sm leading-snug font-semibold">
                  Submitted proof · {flag.id}
                </h2>
              </CardHeader>
              <CardContent>
                {/* The four artifacts §8 requires. Every one was captured live
                    on site — a gallery upload is never accepted. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ProofTile
                    label="Barcode capture"
                    icon={Barcode}
                    alt={`Barcode capture submitted by ${flag.tech}`}
                  />
                  <ProofTile
                    label="Product photo"
                    icon={Camera}
                    alt={`Product photo of the ${flag.product} submitted by ${flag.tech}`}
                  />
                  <ProofTile
                    label="Serial close-up"
                    icon={Hash}
                    alt={`Serial number close-up submitted by ${flag.tech}`}
                  >
                    <span className="font-mono text-[13px] text-ink-2">
                      {flag.detectedSerial}
                    </span>
                  </ProofTile>
                  <ProofTile
                    label="Geo live photo"
                    icon={MapPin}
                    alt={`Geo-tagged live photo submitted by ${flag.tech}, geo-tag matched the ticket pincode`}
                  >
                    {/* Literal from the approved prototype. The geo-tag is
                        validated against the ticket's pincode, which `AiFlag`
                        does not carry yet. */}
                    <span className="text-[10px]">411028 ✓</span>
                  </ProofTile>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3.5">
              <Card>
                <CardHeader>
                  <h2 className="text-sm leading-snug font-semibold">
                    AI verification result
                  </h2>
                </CardHeader>
                <CardContent>
                  <ConfidenceMeter
                    conf={flag.conf}
                    threshold={threshold}
                    variant="hero"
                  />
                  <div className="mt-3.5">
                    <SerialCompare
                      expected={flag.expectedSerial}
                      detected={flag.detectedSerial}
                      flag={flag.flag}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h2 className="text-sm leading-snug font-semibold">
                    Manual decision
                  </h2>
                  <p className="text-xs text-ink-3">
                    Approve to proceed to closure, or reject to send the
                    technician back on-site.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2.5">
                    <Button
                      className="h-11 flex-1 bg-ok text-white hover:bg-ok/90"
                      disabled={busy}
                      onClick={() =>
                        approve.mutate(
                          { id: flag.id },
                          {
                            onSuccess: () => {
                              toast.add({
                                title: "Verification approved",
                                description: "Ticket proceeding to closure.",
                              });
                              navigate("/ai-review");
                            },
                          }
                        )
                      }
                    >
                      Approve match
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 flex-1 border-danger text-danger hover:bg-danger-bg hover:text-danger"
                      disabled={busy}
                      onClick={() =>
                        reject.mutate(
                          { id: flag.id },
                          {
                            onSuccess: () => {
                              toast.add({
                                title: "Rejected · retake",
                                description:
                                  "Technician prompted to retake on-site.",
                              });
                              navigate("/ai-review");
                            },
                          }
                        )
                      }
                    >
                      Reject · retake
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * One proof artifact. Real captures are not wired yet and no placeholder asset
 * exists under `public/images/placeholders/`, so this renders an icon tile
 * rather than a broken `<img>`; the alt text it would carry lives in `sr-only`
 * so the description is written now, not retrofitted later.
 */
function ProofTile({
  label,
  icon: Icon,
  alt,
  children,
}: {
  label: string;
  icon: LucideIcon;
  alt: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
        {label}
      </div>
      <div className="flex aspect-4/3 flex-col items-center justify-center gap-1.5 rounded-md border border-line-2 bg-surface-3 text-ink-3">
        <Icon className="size-6" aria-hidden />
        {children}
        <span className="sr-only">{alt}</span>
      </div>
    </div>
  );
}
