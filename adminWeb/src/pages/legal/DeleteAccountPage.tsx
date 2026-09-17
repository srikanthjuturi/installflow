import { Archive, LogOut, Mail, ShieldAlert, Smartphone } from "lucide-react";
import {
  LegalLayout,
  LegalList,
  type LegalSectionData,
  LEGAL_CONTACT_EMAIL,
} from "@/components/legal/LegalLayout";
import { BRAND_NAME } from "@/lib/brand";

const SECTIONS: LegalSectionData[] = [
  {
    id: "in-the-app",
    title: "Delete your account, in the app",
    icon: Smartphone,
    content: (
      <LegalList>
        <li>
          Open the {BRAND_NAME} Technician app and go to{" "}
          <strong>Profile</strong>.
        </li>
        <li>
          Tap <strong>Delete account</strong> and continue.
        </li>
        <li>
          We send a one-time code to your registered mobile number by
          WhatsApp — the same number you sign in with.
        </li>
        <li>Enter the code. Your account is deleted immediately.</li>
      </LegalList>
    ),
  },
  {
    id: "before-you-delete",
    title: "Before you delete",
    icon: ShieldAlert,
    content: (
      <p>
        If you have a job that isn&rsquo;t finished yet, the request is
        refused until it&rsquo;s closed or your manager reassigns it — a
        technician can&rsquo;t disappear out from under a customer who is
        expecting them.
      </p>
    ),
  },
  {
    id: "what-happens",
    title: "What happens when you delete it",
    icon: LogOut,
    content: (
      <LegalList>
        <li>You&rsquo;re signed out immediately, on every device.</li>
        <li>
          You come off the technician roster — you stop receiving new job
          offers and no longer show up as an active technician to the
          company you worked for.
        </li>
        <li>
          Your profile photo, UPI details and coverage areas are cleared.
        </li>
      </LegalList>
    ),
  },
  {
    id: "what-we-keep",
    title: "What we keep, and why",
    icon: Archive,
    content: (
      <p>
        Job proof — photos, serials, timestamps and location — and payout
        history for jobs you already completed are kept, the same as while
        your account was active. That&rsquo;s for warranty claims, audits
        and dispute resolution, which for an installed product can be years
        after the visit — deleting your account doesn&rsquo;t delete the
        record of work already done.
      </p>
    ),
  },
  {
    id: "no-app-access",
    title: "No access to the app or your phone?",
    icon: Mail,
    content: (
      <p>
        Write to{" "}
        <a
          className="text-brand-600 underline underline-offset-2"
          href={`mailto:${LEGAL_CONTACT_EMAIL}`}
        >
          {LEGAL_CONTACT_EMAIL}
        </a>{" "}
        from the email or number on file and ask for your account to be
        deleted. We&rsquo;ll process the request and confirm once it&rsquo;s
        done.
      </p>
    ),
  },
];

const SUMMARY = [
  "Deleting your account signs you out immediately and removes you from your company's technician roster.",
  "It's proved with a one-time code to your registered WhatsApp number — the same way you sign in.",
  "Job records you're already part of are kept for warranty and dispute purposes, the same as while your account was active.",
  "No app or phone access? Email us and we'll delete it for you.",
];

/**
 * `/delete-account` — public, unauthenticated, reachable signed-in or
 * signed-out. Google Play requires this: a public page describing how to
 * delete an account created in the app, reachable even without the app
 * installed. Written for the TECHNICIAN app specifically, same audience as
 * `/privacy` — a technician's account can't actually be deleted from here
 * (there's no technician sign-in on the web), so this page documents the
 * in-app steps and gives a fallback for someone who no longer has the app.
 */
export default function DeleteAccountPage() {
  return (
    <LegalLayout
      current="delete-account"
      title="Delete Account"
      description={`How to delete your ${BRAND_NAME} Technician account.`}
      heading="Delete Account"
      intro={
        <p>
          This covers the {BRAND_NAME} Technician app — the app a technician
          signs in to with their mobile number to accept, travel to and
          close installation and service jobs. Deleting your account is done
          from inside the app; this page explains what happens and what to
          do if you no longer have it.
        </p>
      }
      summary={SUMMARY}
      sections={SECTIONS}
    />
  );
}
