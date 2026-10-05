/**
 * Where to get the technician app, as the API this console talks to knows it.
 *
 * One answer per server: production's is the Play Store listing, dev's is the
 * latest `preview` APK. The console asks rather than carrying its own copy, so
 * the dev console and the production console each show their own app, and the
 * sign-in QR can never disagree with the invite page's download button — both
 * read the API's `TECHNICIAN_APP_LINK`. Public: it is shown before sign-in.
 */

import { apiGet } from "./http";

export async function getTechnicianAppLink(): Promise<string> {
  const { technicianAppLink } = await apiGet<{ technicianAppLink: string }>(
    "/onboarding/app-link"
  );
  return technicianAppLink;
}
