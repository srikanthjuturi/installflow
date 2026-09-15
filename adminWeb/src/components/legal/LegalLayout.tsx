import { type ReactNode } from "react";
import { ArrowUp, CheckCircle2, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "@/components/shared/BrandMark";
import { PageMeta } from "@/components/shared/PageMeta";
import { BRAND_MARK, BRAND_NAME } from "@/lib/brand";

/**
 * The one address published for someone to write to about either page —
 * including, for the privacy policy, to raise a grievance about how their
 * data was handled. Not sourced from `useBrand` — a company has no privacy
 * policy of its own, this is the platform's, so the contact is the
 * platform's too.
 */
export const LEGAL_CONTACT_EMAIL = "support@reliancegreentech.in";

/** Bump this the day either page's content actually changes. */
export const LEGAL_LAST_UPDATED = "15 September 2026";

export interface LegalSectionData {
  id: string;
  title: string;
  icon: LucideIcon;
  content: ReactNode;
}

interface LegalLayoutProps {
  current: "privacy" | "terms";
  title: string;
  description: string;
  heading: string;
  intro: ReactNode;
  /** Plain-language highlights, rendered above the table of contents. */
  summary: string[];
  sections: LegalSectionData[];
}

/**
 * The shell both `/privacy` and `/terms` sit in.
 *
 * Standalone, not inside `AppShell`/`VendorShell`/`SuperadminShell` — those
 * assume a signed-in session with a company to wear, and these two pages
 * deliberately never do: they describe the PLATFORM's own handling of data
 * and its own terms, not any one tenant's, so the brand here is the static
 * `BRAND_NAME`/`BRAND_MARK` (same source `LoginPage`/`BrandPanel` use), never
 * `useBrand()`. Two consumers, extracted for the same reason `AuthLayout`
 * was: the alternative is two copies of the same header/nav/footer that can
 * silently drift apart.
 *
 * Sections are DATA, not raw children — the table of contents is built from
 * the same array the body renders, so the two can never disagree about what
 * exists or what order it's in.
 */
export function LegalLayout({
  current,
  title,
  description,
  heading,
  intro,
  summary,
  sections,
}: LegalLayoutProps) {
  return (
    <>
      <PageMeta title={title} description={description} />
      <div className="min-h-svh bg-background px-6 py-12">
        <div className="mx-auto w-full max-w-170">
          <div id="top" className="flex items-center gap-2.5 scroll-mt-6">
            <BrandMark mark={BRAND_MARK} tone="brand" className="rounded-[8px]" />
            <div className="text-sm font-semibold text-ink">
              {BRAND_NAME}
              <span className="font-normal text-ink-3"> Technician</span>
            </div>
          </div>

          <nav className="mt-4 flex items-center gap-2 text-[13px]">
            <Link
              to="/privacy"
              className={
                current === "privacy"
                  ? "font-semibold text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }
            >
              Privacy Policy
            </Link>
            <span className="text-ink-3" aria-hidden>
              &middot;
            </span>
            <Link
              to="/terms"
              className={
                current === "terms"
                  ? "font-semibold text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }
            >
              Terms of Service
            </Link>
          </nav>

          <h1 className="mt-7 text-[26px] leading-tight font-semibold tracking-tight text-ink">
            {heading}
          </h1>
          <p className="mt-1.5 text-xs text-ink-3">
            Last updated {LEGAL_LAST_UPDATED}
          </p>

          <div className="mt-5 text-sm leading-relaxed text-ink-2">{intro}</div>

          <div className="mt-6 rounded-lg border border-info/20 bg-info-bg px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-wide text-info uppercase">
              In short
            </p>
            <ul className="mt-2 space-y-1.5">
              {summary.map((line) => (
                <li key={line} className="flex gap-2 text-[13px] leading-relaxed text-info">
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                    strokeWidth={2.25}
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <nav
            aria-label="Sections on this page"
            className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-2"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
              >
                <section.icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="truncate">{section.title}</span>
              </a>
            ))}
          </nav>

          <div className="mt-9 space-y-9">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6">
                <div className="flex items-center gap-2">
                  <section.icon
                    className="size-4 shrink-0 text-ink-3"
                    aria-hidden
                    strokeWidth={2}
                  />
                  <h2 className="text-base font-semibold text-ink">
                    {section.title}
                  </h2>
                </div>
                <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-ink-2">
                  {section.content}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-10 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-3">
                Questions, or a grievance about how your data was handled?
                Write to{" "}
                <a
                  className="text-brand-600 underline underline-offset-2"
                  href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                >
                  {LEGAL_CONTACT_EMAIL}
                </a>
                .
              </p>
              <a
                href="#top"
                className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
              >
                <ArrowUp className="size-3.5" aria-hidden />
                Back to top
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}
