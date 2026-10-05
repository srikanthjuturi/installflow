import { BrandMark } from "@/components/shared/BrandMark";
import { QrCode } from "@/components/shared/QrCode";
import { useTechnicianAppLink } from "@/hooks/useTechnicianAppLink";
import { BRAND_MARK, BRAND_NAME } from "@/lib/brand";

const STATS = [
  { value: "2,481", label: "tickets this month" },
  { value: "96.2%", label: "SLA adherence" },
  { value: "318", label: "active technicians" },
];

/**
 * Left half of the sign-in split. Decorative — hidden below `md`.
 *
 * The PLATFORM brand, deliberately: nobody has signed in yet, so there is no
 * company to name. Every signed-in surface wears the active company instead
 * (`hooks/useBrand.ts`).
 */
export function BrandPanel() {
  const appLink = useTechnicianAppLink();

  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-linear-150 from-brand-600 via-brand-500 to-brand-400 p-14 text-white md:flex">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.09) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        <BrandMark
          mark={BRAND_MARK}
          className="size-9.5 rounded-[9px] text-base"
        />
        <div className="text-base font-semibold">
          {BRAND_NAME}
          <span className="font-normal opacity-60"> · Ops Console</span>
        </div>
      </div>

      <div className="relative max-w-[420px]">
        <p className="text-[34px] leading-[1.18] font-semibold tracking-tight">
          Installation &amp; Demo operations, under control.
        </p>
        <p className="mt-4.5 text-[15px] leading-relaxed text-brand-200">
          Intake to closure — SLA tracking, escalations, technician assignment,
          AI proof verification and audit-ready closures in one place.
        </p>
        <div className="mt-7.5 flex gap-6.5">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-[22px] font-semibold">{s.value}</div>
              <div className="text-xs text-brand-200">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex flex-col gap-7">
        {/* For a technician standing beside this screen. Here rather than under
            the form because the form is for console accounts only, and it
            leaves the panel along with everything else below `md` — a QR on a
            phone's own screen is one nobody can scan.

            The link is the API's own `TECHNICIAN_APP_LINK`, not a copy in this
            bundle: the production console shows the Play Store and the dev
            console the latest preview build. No link, no card — never an empty
            box saying "scan this". */}
        {appLink.data && (
          <div className="flex max-w-[420px] items-center gap-4.5 rounded-xl border border-white/15 bg-white/8 p-4">
            <QrCode
              value={appLink.data}
              label="QR code to download the Technician app"
              className="shrink-0 rounded-lg p-1.5"
              codeClassName="size-29"
            />
            <div>
              <div className="text-sm font-semibold">Technician app</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-brand-200">
                Scan with your Android phone&rsquo;s camera to download it.
              </p>
            </div>
          </div>
        )}

        <div className="text-xs text-brand-300">
          © {new Date().getFullYear()} {BRAND_NAME} · Internal use only
        </div>
      </div>
    </div>
  );
}
