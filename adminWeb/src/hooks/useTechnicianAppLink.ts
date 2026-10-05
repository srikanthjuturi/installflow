import { useQuery } from "@tanstack/react-query";
import { getTechnicianAppLink } from "@/services/appLink";

/**
 * The technician app's download link, for the sign-in QR.
 *
 * It changes only when the API is redeployed with a new one, so it is read
 * once per visit. A failure is not toasted: the sign-in page simply leaves the
 * QR out, which is better than an error over a form that works.
 */
export function useTechnicianAppLink() {
  return useQuery({
    queryKey: ["app-link", "technician"],
    queryFn: getTechnicianAppLink,
    staleTime: Infinity,
    retry: 1,
    meta: { suppressErrorToast: true },
  });
}
