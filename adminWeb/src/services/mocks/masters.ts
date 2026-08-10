import type { Vendor } from "@/types";

export const VENDORS: Vendor[] = [
  {
    id: "VN-01",
    name: "Videocon",
    channel: "API",
    status: "Active",
    tickets: 1284,
    key: "vc_live_9f2a…c41",
    since: "2021",
  },
  {
    id: "VN-02",
    name: "Kelvinator",
    channel: "Excel",
    status: "Active",
    tickets: 642,
    key: "—",
    since: "2022",
  },
  {
    id: "VN-03",
    name: "Sansui",
    channel: "API",
    status: "Active",
    tickets: 398,
    key: "ss_live_71be…9d0",
    since: "2022",
  },
  {
    id: "VN-04",
    name: "Electrolux",
    channel: "Manual",
    status: "Active",
    tickets: 157,
    key: "—",
    since: "2023",
  },
  {
    id: "VN-05",
    name: "Onida",
    channel: "Excel",
    status: "Paused",
    tickets: 44,
    key: "—",
    since: "2024",
  },
];


/** Not in the requirement doc's required-field list, but the prototype
 *  collects it — flagged as an open question. */
export const REQUEST_TYPES = [
  "Installation",
  "Demo",
  "Installation + Demo",
] as const;
