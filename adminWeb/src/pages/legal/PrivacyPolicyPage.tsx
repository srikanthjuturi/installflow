import {
  Baby,
  Clock,
  Lock,
  MapPin,
  RefreshCw,
  ScrollText,
  Share2,
  ShieldCheck,
  Smartphone,
  User,
  Wallet,
} from "lucide-react";
import {
  LegalLayout,
  type LegalSectionData,
  LegalList,
} from "@/components/legal/LegalLayout";
import { BRAND_NAME } from "@/lib/brand";

const SECTIONS: LegalSectionData[] = [
  {
    id: "account-information",
    title: "Account information",
    icon: User,
    content: (
      <p>
        Your name, mobile number, and profile photo. Your mobile number is
        your login — we send a one-time code to it each time you sign in, so
        there is no password to leak.
      </p>
    ),
  },
  {
    id: "job-proof",
    title: "Job proof",
    icon: ScrollText,
    content: (
      <p>
        When you close a job we capture a barcode scan, the unit&rsquo;s
        serial number, photos of the installed product, and a live photo
        taken with your camera at the moment of capture. Photos from your
        gallery are never accepted — proof has to be taken there and then,
        which is also why gallery uploads would defeat the point of proof.
      </p>
    ),
  },
  {
    id: "location",
    title: "Location",
    icon: MapPin,
    content: (
      <p>
        The live site photo is tagged with your device&rsquo;s location at
        the instant you take it, so the job can be confirmed as done at the
        customer&rsquo;s address. We do not track your location at any other
        time, and the app never asks for background location access.
      </p>
    ),
  },
  {
    id: "payout-details",
    title: "Payout details",
    icon: Wallet,
    content: (
      <>
        <p>
          If you add a UPI ID to receive payouts, we store the UPI ID and
          the account holder name exactly as your bank or UPI app shows
          them. We never see or store your bank account number, card
          details, or UPI PIN — those never pass through this app.
        </p>
        <p>
          You can enter it by typing, or by scanning a UPI QR code with your
          camera or from a screenshot in your photo library. A scanned image
          is read on your device only, to pull out the UPI ID and name — it
          is never uploaded or stored anywhere.
        </p>
      </>
    ),
  },
  {
    id: "device-data",
    title: "Device & notifications",
    icon: Smartphone,
    content: (
      <p>
        A push-notification token so we can alert you to new jobs and
        reminders, and basic technical data (app version, device model, OS
        version) to keep the app working and to diagnose problems you
        report.
      </p>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    icon: RefreshCw,
    content: (
      <LegalList>
        <li>
          To create and verify your technician account, and to identify you
          when you sign in.
        </li>
        <li>
          To offer you jobs in your coverage area, and to let the company
          you work for confirm you attended the address and completed the
          work.
        </li>
        <li>
          To calculate and pay out what you&rsquo;ve earned, and to let you
          redeem it to your UPI ID.
        </li>
        <li>To send you job offers, slot reminders and status updates.</li>
        <li>
          To investigate a mismatched serial, a disputed job, or a report of
          misuse.
        </li>
      </LegalList>
    ),
  },
  {
    id: "who-we-share-with",
    title: "Who we share it with",
    icon: Share2,
    content: (
      <>
        <p>
          The company you are onboarded under sees your job history, your
          proof photos, your location on completed jobs, and your payout
          status — they are the ones assigning you work and paying you, so
          this is the working relationship, not a third-party disclosure.
        </p>
        <p>
          We use a small number of service providers to run the app, each
          processing only what their service needs: WhatsApp/Meta to
          deliver sign-in codes and job notifications, Google Firebase to
          deliver push notifications, and Microsoft Azure to host the
          app&rsquo;s servers, database and photo storage, in India. We do
          not sell your information, and we do not share it with anyone for
          their own advertising.
        </p>
        <p>
          The app, and the web console your company uses to manage jobs, also
          use Google Analytics, Microsoft Clarity and PostHog to understand
          how they are used and to find and fix errors. They receive the
          screens you open, the actions you complete (such as accepting a job
          or requesting a payout), and error reports, linked to your
          technician ID; Clarity also receives recordings of how you move
          through the app, with the text on screen hidden. They do not receive
          your name, phone number, photos or UPI ID. These providers may
          process this information outside India.
        </p>
        <p>
          We may disclose information if the law requires it, or to protect
          the safety of a technician, a customer, or the public.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    icon: Clock,
    content: (
      <p>
        Your account data is kept while your account is active. Job proof —
        photos, serials, timestamps and location — is kept for as long as
        the company you worked for needs it for warranty claims, audits or
        dispute resolution, which for an installed product can be years
        after the visit. If your account is removed, past job records are
        kept for the same reason rather than deleted with it.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights & grievance redressal",
    icon: ShieldCheck,
    content: (
      <p>
        You can update your profile photo and payout details from within
        the app. To access, correct, or request deletion of your data, or
        to raise a grievance about how it has been handled, write to the
        address below — we aim to acknowledge within a few days and resolve
        within 30 days, except where we are required to keep a record for
        the reasons above.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    icon: Lock,
    content: (
      <p>
        The app talks to our servers only over encrypted connections. Your
        sign-in session is stored in your device&rsquo;s own secure
        hardware storage (the Android Keystore), not in plain app storage,
        and is never visible to us or to anyone else with access to your
        phone&rsquo;s files.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    icon: Baby,
    content: (
      <p>
        This app is for working technicians and is not directed at
        children. We do not knowingly collect information from anyone under
        the age of 18.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    icon: RefreshCw,
    content: (
      <p>
        If this policy changes in a way that matters, we will update the
        date above and, where the change is significant, tell you inside
        the app.
      </p>
    ),
  },
];

const SUMMARY = [
  "We capture your location only at the moment you photograph a completed job — never in the background.",
  "Your UPI ID pays you; we never see your bank account number, card details, or UPI PIN.",
  "We never sell your data, and we never share it for anyone else's advertising.",
  "You can ask us to access, correct, or delete your data at any time.",
];

/**
 * `/privacy` — public, unauthenticated, reachable signed-in or signed-out.
 *
 * Written for the TECHNICIAN app specifically, not the console or the
 * vendor portal, which have their own sign-in and their own audience. The
 * Play Console listing for the technician app links here.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      current="privacy"
      title="Privacy Policy"
      description={`How the ${BRAND_NAME} Technician app collects and uses your data.`}
      heading="Privacy Policy"
      intro={
        <p>
          This policy covers the {BRAND_NAME} Technician app — the app a
          technician signs in to with their mobile number to accept, travel
          to and close installation and service jobs. It does not cover the{" "}
          {BRAND_NAME} console or vendor portal, which have their own
          sign-in and their own audience.
        </p>
      }
      summary={SUMMARY}
      sections={SECTIONS}
    />
  );
}
