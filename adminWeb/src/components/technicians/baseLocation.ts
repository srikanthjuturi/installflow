/**
 * Everything pure about a technician's base location — the India box, the
 * rounding, the words and chips (R9), and the PUT body. No React, so the
 * dialog, the panel and the list column share one vocabulary and one test.
 */

import { z } from "zod";
import type {
  BaseLocation,
  BaseLocationInput,
  BaseSource,
} from "@/types/allowances";

/** India's box — mirrors `INDIA_LAT` / `INDIA_LON` in `app/core/coordinates.py`. */
export const INDIA_LAT: readonly [number, number] = [6, 38];
export const INDIA_LON: readonly [number, number] = [68, 98];

export const inIndia = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= INDIA_LAT[0] &&
  lat <= INDIA_LAT[1] &&
  lng >= INDIA_LON[0] &&
  lng <= INDIA_LON[1];

/** 5 decimal places (≈ 1 m) — what the server stores and the pin deserves. */
export const roundCoord = (n: number): number => Math.round(n * 1e5) / 1e5;

/** `17.44012, 78.3489` — rounded, no padding. */
export const formatLatLng = (lat: number, lng: number): string =>
  `${roundCoord(lat)}, ${roundCoord(lng)}`;

/** How the base was fixed, in words. */
export const BASE_SOURCE_LABEL: Record<BaseSource, string> = {
  pincode: "Pincode",
  gps: "GPS",
  map: "Map",
  manual: "Set by admin",
};

export interface BaseChip {
  label: string;
  /** Static Tailwind classes — a word always rides with the tint. */
  class: string;
}

const NEUTRAL_CHIP = "bg-surface-3 text-ink-2";

/**
 * The chip beside a base (R9): a self-set base is visible, never hidden. Typed
 * coordinates read *Set by admin* because only a manager can send them. An
 * unknown source (a newer server) prints its raw word on a neutral chip.
 */
export const BASE_SOURCE_CHIP: Record<BaseSource, BaseChip> = {
  pincode: { label: "Pincode", class: "bg-info-bg text-info" },
  gps: { label: "GPS", class: "bg-ok-bg text-ok" },
  map: { label: "Map", class: "bg-brand-100 text-brand-500" },
  manual: { label: "Set by admin", class: NEUTRAL_CHIP },
};

/** Own-property lookup, so a source called `constructor` cannot return a function. */
export function baseChip(source: string): BaseChip {
  return Object.prototype.hasOwnProperty.call(BASE_SOURCE_CHIP, source)
    ? BASE_SOURCE_CHIP[source as BaseSource]
    : { label: source, class: NEUTRAL_CHIP };
}

/** The panel's first line: where the base is, by how it was fixed. */
export function describeBase(
  base: Pick<BaseLocation, "source" | "pincode">
): string {
  switch (base.source) {
    case "pincode":
      return base.pincode
        ? `Pincode ${base.pincode} (area centre)`
        : "Pincode (area centre)";
    case "map":
      return "Pin on the map";
    case "gps":
      return "Phone location";
    case "manual":
      return "Typed coordinates";
    default:
      // A source this build has never heard of: say it, don't invent a phrase.
      return String(base.source);
  }
}

/** What the dialog holds when it saves. */
export interface BaseFormValues {
  mode: "pincode" | "map" | "manual";
  pincode: string;
  latitude: string;
  longitude: string;
}

/**
 * The PUT body. A pincode base sends `{ pincode }` and NOTHING else (the server
 * 422s a pincode with a stray point); a map or typed base sends the rounded
 * point and its source.
 */
export function toBaseBody(values: BaseFormValues): BaseLocationInput {
  if (values.mode === "pincode") return { pincode: values.pincode.trim() };
  return {
    latitude: roundCoord(Number(values.latitude)),
    longitude: roundCoord(Number(values.longitude)),
    source: values.mode,
  };
}

/* ── the dialog's validation ──────────────────────────────────────────────── */

export type BaseFormErrors = Partial<Record<"pincode" | "latitude" | "longitude", string>>;

/**
 * What is wrong with the dialog's values, by field — pure, so the India check
 * and the mode rules are tested without a form. A pincode base needs six
 * digits and nothing else; a map or typed base needs a finite point inside
 * India. The server re-checks everything (`BASE_OUTSIDE_INDIA` is its word for
 * the same box); this only puts the sentence on the field before the trip.
 */
export function validateBaseForm(values: BaseFormValues): BaseFormErrors {
  const errors: BaseFormErrors = {};
  if (values.mode === "pincode") {
    if (!/^\d{6}$/.test(values.pincode.trim())) {
      errors.pincode = "Enter a 6-digit pincode";
    }
    return errors;
  }

  const num = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));
  const lat = num(values.latitude);
  const lng = num(values.longitude);
  if (!Number.isFinite(lat)) errors.latitude = "Enter a latitude";
  if (!Number.isFinite(lng)) errors.longitude = "Enter a longitude";
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !inIndia(lat, lng)
  ) {
    errors.latitude = "That point is outside India.";
  }
  return errors;
}

export const baseFormSchema = z
  .object({
    mode: z.enum(["pincode", "map", "manual"]),
    pincode: z.string(),
    latitude: z.string(),
    longitude: z.string(),
  })
  .superRefine((values, ctx) => {
    for (const [field, message] of Object.entries(validateBaseForm(values))) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

/**
 * The panel's "who" line (R9) — a self-set base is SHOWN, never hidden:
 *
 *   `Set by the technician · 12 Oct, 4:30 PM`
 *   `Set by Meena R (Franchisee Admin) · 12 Oct, 4:30 PM`
 *
 * `setByName` is null when that user was since deleted, and the list fields a
 * viewer who cannot manage the technician sees carry no name at all — then the
 * line says only when, which is still true.
 */
export function setByLine(
  base: {
    setBySelf: boolean | null;
    setByName?: string | null;
    setByRole?: string | null;
  },
  when: string
): string {
  if (base.setBySelf) return `Set by the technician · ${when}`;
  if (base.setByName) {
    const role = base.setByRole ? ` (${base.setByRole})` : "";
    return `Set by ${base.setByName}${role} · ${when}`;
  }
  return `Set · ${when}`;
}
