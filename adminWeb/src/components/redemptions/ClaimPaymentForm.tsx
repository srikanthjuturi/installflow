import { PaymentProofForm } from "@/components/shared/PaymentProofForm";
import { toast } from "@/components/ui/toast";
import { useClaimRedemption } from "@/hooks/useRedemptions";

/**
 * "I paid" a technician's redemption, with the screenshot that shows it.
 *
 * The screenshot is REQUIRED and the UTR is not, and the asymmetry is the
 * point: the screenshot is on the payer's phone at this exact moment, while a
 * UTR is a string they would have to go and find and could mistype. Neither
 * proves anything on its own — which is why the technician still confirms.
 * The form itself is `PaymentProofForm`, shared with a credit recharge.
 */
export function ClaimPaymentForm({ redemptionId }: { redemptionId: string }) {
  const claim = useClaimRedemption();
  return (
    <PaymentProofForm
      idPrefix="claim"
      utrRequired={false}
      utrLabel="UTR / reference (optional)"
      submitLabel="Mark as paid"
      pending={claim.isPending}
      onSubmit={async ({ proof, utr }) => {
        await claim.mutateAsync({ id: redemptionId, proof, utr: utr || undefined });
        toast.add({ title: "Marked as paid" });
      }}
    />
  );
}
