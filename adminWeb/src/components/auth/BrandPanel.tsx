const STATS = [
  { value: "2,481", label: "tickets this month" },
  { value: "96.2%", label: "SLA adherence" },
  { value: "318", label: "active technicians" },
];

/** Left half of the sign-in split. Decorative — hidden below `md`. */
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
        <div className="text-brand-500 grid size-9.5 place-items-center rounded-[9px] bg-white text-lg font-bold">
          IF
        </div>
        <div className="text-base font-semibold">
          InstallFlow<span className="font-normal opacity-60"> · Ops Console</span>
        </div>
      </div>

      <div className="relative max-w-[420px]">
        <p className="text-[34px] leading-[1.18] font-semibold tracking-tight">
          Installation &amp; Demo operations, under control.
        </p>
        <p className="text-brand-200 mt-4.5 text-[15px] leading-relaxed">
          Intake to closure — SLA tracking, escalations, technician assignment, AI proof
          verification and audit-ready closures in one place.
        </p>
        <div className="mt-7.5 flex gap-6.5">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-[22px] font-semibold">{s.value}</div>
              <div className="text-brand-200 text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-brand-300 relative text-xs">
        © 2026 InstallFlow · Internal use only
      </div>
    </div>
  );
}
