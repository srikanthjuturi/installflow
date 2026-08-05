import type { Category, Vendor } from "@/types";

export const VENDORS: Vendor[] = [
  { id: "VN-01", name: "Videocon", channel: "API", status: "Active", tickets: 1284, key: "vc_live_9f2a…c41", since: "2021" },
  { id: "VN-02", name: "Kelvinator", channel: "Excel", status: "Active", tickets: 642, key: "—", since: "2022" },
  { id: "VN-03", name: "Sansui", channel: "API", status: "Active", tickets: 398, key: "ss_live_71be…9d0", since: "2022" },
  { id: "VN-04", name: "Electrolux", channel: "Manual", status: "Active", tickets: 157, key: "—", since: "2023" },
  { id: "VN-05", name: "Onida", channel: "Excel", status: "Paused", tickets: 44, key: "—", since: "2024" },
];

export const CATEGORIES: Category[] = [
  {
    name: "Television",
    models: ['43" 4K UHD', '55" QLED', '50" 4K', '32" HD', '40" FHD'],
    techs: 34,
    active: true,
  },
  {
    name: "Refrigerator",
    models: ["340L Frost-Free", "253L Direct Cool", "470L Side-by-Side"],
    techs: 28,
    active: true,
  },
  {
    name: "Washing Machine",
    models: ["7kg Front Load", "6.5kg Top Load", "8kg Front Load"],
    techs: 22,
    active: true,
  },
  {
    name: "Air Conditioner",
    models: ["1.5T Inverter Split", "1T Window AC", "2T Cassette"],
    techs: 19,
    active: true,
  },
  {
    name: "Microwave",
    models: ["28L Convection", "20L Solo", "30L Grill"],
    techs: 15,
    active: true,
  },
];

/** Not in the requirement doc's required-field list, but the prototype
 *  collects it — flagged as an open question. */
export const REQUEST_TYPES = ["Installation", "Demo", "Installation + Demo"] as const;
