import { Navigate } from "react-router";
import { PageSkeleton } from "@/components/shared/PageSkeleton";
import { useFeatureAccess } from "@/hooks/useAuth";
import { franchiseLanding } from "@/components/franchise/franchiseNav";

/**
 * `/franchise` — not a screen, a redirect (§5.6).
 *
 * A franchise session's landing is its first HELD rail entry (`franchiseNav`'s
 * order is the preference), so a franchisee admin lands on Technicians and a
 * facility role on Tickets. It sits OUTSIDE the feature guard on purpose:
 * gating a redirector that redirects to the guard's own landing fallback would
 * loop — the reasoning `routes.tsx` records beside this element.
 */
export default function FranchiseLanding() {
  const { has, loading } = useFeatureAccess();

  if (loading) return <PageSkeleton />;
  return <Navigate to={franchiseLanding(has)} replace />;
}