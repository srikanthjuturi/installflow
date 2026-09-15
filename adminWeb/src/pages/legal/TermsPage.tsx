import {
  Briefcase,
  ClipboardCheck,
  ListChecks,
  RefreshCw,
  Scale,
  UserX,
  Users,
  Wallet,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  LegalLayout,
  type LegalSectionData,
  LegalList,
} from "@/components/legal/LegalLayout";
import { BRAND_NAME } from "@/lib/brand";

const SECTIONS: LegalSectionData[] = [
  {
    id: "who-this-is-for",
    title: "Who this is for",
    icon: Users,
    content: (
      <p>
        The app is for technicians who have been onboarded — invited or
        added directly — by a company using this platform to manage
        installation and service work. Access is by mobile number and a
        one-time code; there is no separate password, and you are
        responsible for keeping your phone and that code to yourself.
      </p>
    ),
  },
  {
    id: "accepting-completing-jobs",
    title: "Accepting and completing jobs",
    icon: ClipboardCheck,
    content: (
      <>
        <p>
          A job appears in your pool once a customer has confirmed a time
          slot. Accepting one is first-come — if someone else accepts
          first, the job is no longer available to you, which is a normal
          outcome, not an error. Once you accept, you are committing to
          that slot.
        </p>
        <p>
          Closing a job requires genuine, on-site proof: a barcode scan,
          the correct serial, product photos, and a live photo taken at the
          address. Submitting proof that was not honestly captured on site
          — an old photo, someone else&rsquo;s serial, a fabricated
          location — is a violation of these terms and may end your access
          to the app, independent of any action the company you work for
          takes.
        </p>
      </>
    ),
  },
  {
    id: "cancelling",
    title: "Cancelling a job",
    icon: XCircle,
    content: (
      <p>
        Cancelling a job you have accepted may carry a fee, set by the
        company you work for and shown to you before you confirm the
        cancellation. A no-show — accepting a slot and not attending, with
        no cancellation — is treated more seriously than telling us in
        advance.
      </p>
    ),
  },
  {
    id: "getting-paid",
    title: "Getting paid",
    icon: Wallet,
    content: (
      <p>
        What you earn from completed and force-closed jobs, plus any bonus
        and less any penalty, is your available balance inside the app. You
        request it be paid out to a UPI ID you control; we do not hold a
        bank account on your behalf, and the payment itself is made
        directly by the company you work for, scanning a QR code the app
        generates. Only you can confirm a payout has actually reached you —
        that confirmation is what marks it paid.
      </p>
    ),
  },
  {
    id: "what-we-ask",
    title: "What we ask of you",
    icon: ListChecks,
    content: (
      <LegalList>
        <li>
          Give the company you work for accurate details — your identity,
          your subcategories, your coverage area, your payout account.
        </li>
        <li>
          Treat customers and their property, and customers&rsquo; contact
          details, with the same care you would want shown to you.
        </li>
        <li>
          Don&rsquo;t share your account, your sign-in code, or a
          job&rsquo;s customer details with anyone who isn&rsquo;t meant to
          have them.
        </li>
        <li>
          Don&rsquo;t attempt to manipulate job assignment, proof capture,
          or payouts.
        </li>
      </LegalList>
    ),
  },
  {
    id: "employment-status",
    title: "Not an employment relationship",
    icon: Briefcase,
    content: (
      <p>
        These terms govern your use of the app itself. Your employment or
        contractor status, your pay structure, and every other term of your
        working relationship are between you and the company you work for
        — using this app does not make you an employee or contractor of
        the platform.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    icon: UserX,
    content: (
      <p>
        The company you work for can remove your access at any time — the
        working relationship is between you and them. We can also suspend
        or end your access to the app for violating these terms, for
        fraud, or for misuse that puts customers, other technicians, or
        the platform at risk.
      </p>
    ),
  },
  {
    id: "tool-not-guarantee",
    title: "A tool, not a guarantee",
    icon: Wrench,
    content: (
      <p>
        The app is provided to help you find, do and get paid for work — it
        doesn&rsquo;t guarantee any particular volume of jobs, and it may
        be unavailable at times for maintenance or things outside our
        control. We aren&rsquo;t liable for losses arising from those
        interruptions, or from a company&rsquo;s own decisions about the
        work or pay it offers.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law",
    icon: Scale,
    content: (
      <p>
        These terms are governed by the laws of India, and any dispute
        arising from them is subject to the jurisdiction of the courts of
        India.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    icon: RefreshCw,
    content: (
      <p>
        If these terms change in a way that matters, we will update the
        date above and, where the change is significant, tell you inside
        the app. Continuing to use the app after that means you accept the
        change.
      </p>
    ),
  },
];

const SUMMARY = [
  "Accepting a job slot is a commitment — cancelling may carry a fee your company sets.",
  "Proof has to be genuine and captured on site; fabricated proof can end your access.",
  "Only you can confirm a payout has actually reached you.",
  "Your employment or contractor relationship is with the company you work for, not with us.",
];

/**
 * `/terms` — public, unauthenticated, reachable signed-in or signed-out.
 * Sibling of `PrivacyPolicyPage`; see that file for why both are
 * platform-branded rather than company-branded.
 */
export default function TermsPage() {
  return (
    <LegalLayout
      current="terms"
      title="Terms of Service"
      description={`The terms for using the ${BRAND_NAME} Technician app.`}
      heading="Terms of Service"
      intro={
        <p>
          These terms cover your use of the {BRAND_NAME} Technician app. By
          signing in, you agree to them.
        </p>
      }
      summary={SUMMARY}
      sections={SECTIONS}
    />
  );
}
