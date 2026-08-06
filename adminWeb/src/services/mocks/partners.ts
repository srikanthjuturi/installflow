import type { Partner } from "@/types";

/**
 * Seeded with numbers only — that is genuinely all an appointment records
 * until the invite is completed, so there is no name or coverage to invent.
 */
export const FREELANCERS: Partner[] = [
  {
    id: "FRL-1001",
    kind: "Freelancer",
    phone: "+91 98220 11223",
    status: "Active",
    appointedBy: "ASM",
    appointedOn: "2026-06-18",
  },
  {
    id: "FRL-1002",
    kind: "Freelancer",
    phone: "+91 90280 44519",
    status: "Active",
    appointedBy: "ASM",
    appointedOn: "2026-07-02",
  },
  {
    id: "FRL-1003",
    kind: "Freelancer",
    phone: "+91 77980 63140",
    status: "Invited",
    appointedBy: "RSH",
    appointedOn: "2026-07-29",
  },
  {
    id: "FRL-1004",
    kind: "Freelancer",
    phone: "+91 86000 27384",
    status: "Inactive",
    appointedBy: "ASM",
    appointedOn: "2026-05-11",
  },
];

export const FRANCHISES: Partner[] = [
  {
    id: "FRN-2001",
    kind: "Franchise",
    phone: "+91 20240 88110",
    status: "Active",
    appointedBy: "NH",
    appointedOn: "2026-04-23",
  },
  {
    id: "FRN-2002",
    kind: "Franchise",
    phone: "+91 98501 77206",
    status: "Active",
    appointedBy: "RSH",
    appointedOn: "2026-06-05",
  },
  {
    id: "FRN-2003",
    kind: "Franchise",
    phone: "+91 91580 30947",
    status: "Invited",
    appointedBy: "RSH",
    appointedOn: "2026-08-01",
  },
];
