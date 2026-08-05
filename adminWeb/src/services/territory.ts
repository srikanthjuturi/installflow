import { mockResponse } from "./client";
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
