import { ApiError, mockResponse } from "./client";
import type { RegionTerritory } from "@/types";

/**
 * Territory mapping: Region → Regional Service Head → Area Service Manager →
 * serviced pincodes. The National Head sits above the RSH but owns no
 * pincodes, so it is not part of this mapping.
 *
 * This is not an org chart for display. An ASM owns a pincode range, and
 * pincode eligibility is one of the three things technician notification
 * matches on (category + pincode + free bandwidth) — an unmapped pincode is a
 * ticket nobody gets notified about.
 */
const TERRITORY: RegionTerritory[] = [
  {
    region: "West",
    rsh: "Kavita Rao",
    pincount: 12,
    asms: [
      {
        name: "Ravi Sharma",
        area: "Pune",
        initial: "RS",
        pincodes: ["411001", "411014", "411021", "411028", "411038", "411045", "411057"],
      },
      {
        name: "Sneha Iyer",
        area: "Mumbai",
        initial: "SI",
        pincodes: ["400001", "400051", "400070", "400610", "421201"],
      },
    ],
  },
  {
    region: "North",
    rsh: "Harish Patel",
    pincount: 6,
    asms: [
      {
        name: "Deepak Nair",
        area: "Delhi",
        initial: "DN",
        pincodes: ["110001", "110020", "110058"],
      },
      {
        name: "Anjali Verma",
        area: "Gurugram",
        initial: "AV",
        pincodes: ["122001", "122009", "122018"],
      },
    ],
  },
];

export function listTerritory(): Promise<RegionTerritory[]> {
  return mockResponse(() => TERRITORY);
}

export interface CreateMappingInput {
  /** An existing region name, or a new one. */
  region: string;
  /** Regional Service Head. Only read when the region is new. */
  rsh: string;
  /** Area Service Manager. */
  asm: string;
  area: string;
  pincodes: string[];
}

/** "Ravi Sharma" → "RS". Two letters, matching the existing records. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/**
 * Maps an Area Service Manager, and their pincodes, into a region — creating
 * the region and its RSH if it does not exist yet.
 *
 * A pincode belongs to exactly one ASM: two owners means two managers notified
 * for the same ticket and neither accountable, so an overlap is rejected
 * rather than merged.
 */
export function createMapping(input: CreateMappingInput): Promise<RegionTerritory> {
  return mockResponse(() => {
    if (input.pincodes.length === 0) {
      throw new ApiError("At least one pincode is required", 422);
    }

    const taken = input.pincodes.filter((pincode) =>
      TERRITORY.some((region) => region.asms.some((asm) => asm.pincodes.includes(pincode))),
    );
    if (taken.length > 0) {
      throw new ApiError(`Already mapped to another ASM: ${taken.join(", ")}`, 409);
    }

    let region = TERRITORY.find((r) => r.region === input.region);
    if (!region) {
      region = { region: input.region, rsh: input.rsh, pincount: 0, asms: [] };
      TERRITORY.push(region);
    }

    if (region.asms.some((asm) => asm.name.toLowerCase() === input.asm.toLowerCase())) {
      throw new ApiError(`${input.asm} is already mapped in ${region.region}`, 409);
    }

    region.asms.push({
      name: input.asm,
      area: input.area,
      initial: initialsOf(input.asm),
      pincodes: input.pincodes,
    });
    region.pincount = region.asms.reduce((total, asm) => total + asm.pincodes.length, 0);
    return region;
  });
}
