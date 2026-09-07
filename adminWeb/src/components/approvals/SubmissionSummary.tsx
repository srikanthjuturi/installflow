import { ImageOff } from "lucide-react";
import type { ProductSubmission } from "@/types/approval";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <dt className="w-28 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-ink">{value}</dd>
    </div>
  );
}

/**
 * Everything the vendor sent, above the price boxes.
 *
 * A National Head cannot price something they cannot see, and the queue's row
 * carries only a name and a thumbnail. Read-only: this is the submission, and
 * an approver either prices it or refuses it — editing somebody else's product
 * on the way past would leave nobody able to say what was actually approved.
 */
export function SubmissionSummary({
  submission,
}: {
  submission: ProductSubmission;
}) {
  const s = submission;
  return (
    <section className="grid gap-3 rounded-md bg-surface-2 p-3.5">
      {s.imageUrls.length ? (
        <div className="flex flex-wrap gap-2">
          {s.imageUrls.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              className="size-16 shrink-0 rounded-md border border-line-2 object-cover"
            />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <ImageOff className="size-3.5" aria-hidden />
          No photos were uploaded.
        </p>
      )}

      <dl className="grid gap-1.5">
        <Row label="Brand" value={s.vendorName} />
        <Row label="Category" value={s.nodePath.join(" › ")} />
        <Row label="Service types" value={s.serviceTypes.join(", ")} />
        {s.capacity ? <Row label="Capacity" value={s.capacity} /> : null}
        {s.warrantyMonths === null ? null : (
          <Row label="Warranty" value={`${s.warrantyMonths} months`} />
        )}
        {s.parameters.length ? (
          <Row
            label="Specs"
            value={s.parameters.map((p) => `${p.name}: ${p.value}`).join(" · ")}
          />
        ) : null}
        {s.notes ? <Row label="Notes" value={s.notes} /> : null}
      </dl>

      {/* The one number on this panel that is not the vendor's own words, and
          the reason it is here: approving a product filed under a sub-category
          nobody is certified on means every ticket raised there escalates the
          moment it is created, with nothing on any screen explaining it. */}
      {s.technicianCount === 0 ? (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          No technicians are certified for {s.nodePath.join(" › ")}. Jobs raised
          against this product would escalate with nobody to offer them to.
        </p>
      ) : (
        <p className="text-xs text-ink-3">
          {s.technicianCount} technician{s.technicianCount === 1 ? "" : "s"}{" "}
          certified for this category.
        </p>
      )}
    </section>
  );
}
