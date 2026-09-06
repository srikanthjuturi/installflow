import { BrandMark } from "@/components/shared/BrandMark";
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

      <div className="relative text-xs text-brand-300">
        © {new Date().getFullYear()} {BRAND_NAME} · Internal use only
      </div>
    </div>
  );
}
