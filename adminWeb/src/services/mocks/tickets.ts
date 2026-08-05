import type { Ticket, TimelineEvent } from "@/types";

/** Seeded from the approved prototype. Stable ids so deep links keep working. */
export const TICKETS: Ticket[] = [
  {
    id: "INST-240912",
    vendor: "Videocon",
    category: "Television",
    product: 'Videocon 43" 4K UHD',
    customer: "Anil Deshmukh",
    mobile: "+91 98220 41120",
    city: "Pune",
    pincode: "411014",
    slaType: "24h",
    slot: "Aug 5, 10:00–12:00",
    tech: "Sunil Pawar",
    status: "In Progress",
    sla: "warn",
    created: "Aug 4, 08:12",
    expected: "Aug 5",
  },
  {
    id: "INST-240918",
    vendor: "Videocon",
    category: "Refrigerator",
    product: "Videocon 340L Frost-Free",
    customer: "Meera Joshi",
    mobile: "+91 90110 22890",
    city: "Pune",
    pincode: "411021",
    slaType: "48h",
    slot: "Aug 6, 14:00–16:00",
    tech: "—",
    status: "Slot Pending",
    sla: "ok",
    created: "Aug 4, 09:03",
    expected: "Aug 6",
  },
  {
    id: "INST-240921",
    vendor: "Kelvinator",
    category: "Washing Machine",
    product: "Kelvinator 7kg Front Load",
    customer: "Rajesh Nair",
    mobile: "+91 98765 33110",
    city: "Pimpri",
    pincode: "411018",
    slaType: "24h",
    slot: "Aug 5, 09:00–11:00",
    tech: "—",
    status: "Escalated",
    sla: "breach",
    created: "Aug 4, 06:40",
    expected: "Aug 5",
  },
  {
    id: "INST-240925",
    vendor: "Sansui",
    category: "Air Conditioner",
    product: "Sansui 1.5T Inverter Split",
    customer: "Priya Kulkarni",
    mobile: "+91 89990 71234",
    city: "Pune",
    pincode: "411045",
    slaType: "48h",
    slot: "Aug 6, 11:00–13:00",
    tech: "Imran Shaikh",
    status: "Assigned",
    sla: "ok",
    created: "Aug 4, 10:22",
    expected: "Aug 6",
  },
  {
    id: "INST-240931",
    vendor: "Videocon",
    category: "Television",
    product: 'Videocon 55" QLED',
    customer: "Sameer Bhosale",
    mobile: "+91 70301 55420",
    city: "Hadapsar",
    pincode: "411028",
    slaType: "24h",
    slot: "Aug 5, 15:00–17:00",
    tech: "Sunil Pawar",
    status: "AI Review",
    sla: "warn",
    created: "Aug 4, 07:15",
    expected: "Aug 5",
  },
  {
    id: "INST-240934",
    vendor: "Electrolux",
    category: "Microwave",
    product: "Electrolux 28L Convection",
    customer: "Farida Sheikh",
    mobile: "+91 98201 90087",
    city: "Kothrud",
    pincode: "411038",
    slaType: "48h",
    slot: "Aug 7, 10:00–12:00",
    tech: "Ganesh More",
    status: "Assigned",
    sla: "ok",
    created: "Aug 4, 11:48",
    expected: "Aug 7",
  },
  {
    id: "INST-240940",
    vendor: "Videocon",
    category: "Refrigerator",
    product: "Videocon 253L Direct Cool",
    customer: "Vikram Rane",
    mobile: "+91 96570 11245",
    city: "Wakad",
    pincode: "411057",
    slaType: "24h",
    slot: "Aug 5, 12:00–14:00",
    tech: "—",
    status: "Escalated",
    sla: "breach",
    created: "Aug 4, 05:55",
    expected: "Aug 5",
  },
  {
    id: "INST-240947",
    vendor: "Kelvinator",
    category: "Television",
    product: 'Kelvinator 32" HD',
    customer: "Nisha Agarwal",
    mobile: "+91 88888 43210",
    city: "Aundh",
    pincode: "411007",
    slaType: "48h",
    slot: "Aug 6, 16:00–18:00",
    tech: "Imran Shaikh",
    status: "In Progress",
    sla: "ok",
    created: "Aug 4, 12:30",
    expected: "Aug 6",
  },
  {
    id: "INST-240951",
    vendor: "Sansui",
    category: "Washing Machine",
    product: "Sansui 6.5kg Top Load",
    customer: "Deepak Chavan",
    mobile: "+91 90280 66471",
    city: "Pune",
    pincode: "411001",
    slaType: "24h",
    slot: "Aug 5, 08:00–10:00",
    tech: "Ganesh More",
    status: "Closed",
    sla: "done",
    created: "Aug 3, 18:05",
    expected: "Aug 4",
  },
  {
    id: "INST-240955",
    vendor: "Videocon",
    category: "Air Conditioner",
    product: "Videocon 1T Window AC",
    customer: "Sunita Patil",
    mobile: "+91 98330 77120",
    city: "Katraj",
    pincode: "411046",
    slaType: "48h",
    slot: "Aug 7, 09:00–11:00",
    tech: "—",
    status: "Slot Pending",
    sla: "ok",
    created: "Aug 4, 13:12",
    expected: "Aug 7",
  },
  {
    id: "INST-240960",
    vendor: "Electrolux",
    category: "Refrigerator",
    product: "Electrolux 470L Side-by-Side",
    customer: "Karan Mehta",
    mobile: "+91 99000 12388",
    city: "Baner",
    pincode: "411045",
    slaType: "24h",
    slot: "Aug 5, 13:00–15:00",
    tech: "Sunil Pawar",
    status: "AI Review",
    sla: "warn",
    created: "Aug 4, 09:41",
    expected: "Aug 5",
  },
  {
    id: "INST-240962",
    vendor: "Videocon",
    category: "Television",
    product: 'Videocon 50" 4K',
    customer: "Rohit Gawde",
    mobile: "+91 97654 00219",
    city: "Hinjewadi",
    pincode: "411057",
    slaType: "48h",
    slot: "Aug 6, 10:00–12:00",
    tech: "Imran Shaikh",
    status: "Assigned",
    sla: "ok",
    created: "Aug 4, 14:00",
    expected: "Aug 6",
  },
  {
    id: "INST-240968",
    vendor: "Kelvinator",
    category: "Microwave",
    product: "Kelvinator 20L Solo",
    customer: "Asha Kale",
    mobile: "+91 90040 55198",
    city: "Pune",
    pincode: "411030",
    slaType: "24h",
    slot: "Aug 5, 11:00–13:00",
    tech: "—",
    status: "New",
    sla: "ok",
    created: "Aug 4, 14:22",
    expected: "Aug 5",
  },
  {
    id: "INST-240970",
    vendor: "Sansui",
    category: "Television",
    product: 'Sansui 40" FHD',
    customer: "Manoj Tiwari",
    mobile: "+91 98115 33027",
    city: "Chinchwad",
    pincode: "411019",
    slaType: "48h",
    slot: "Aug 7, 15:00–17:00",
    tech: "Ganesh More",
    status: "Force-Closed",
    sla: "done",
    created: "Aug 3, 16:40",
    expected: "Aug 5",
  },
];

/** Hand-authored trail for the reference ticket. */
const AUTHORED: Record<string, TimelineEvent[]> = {
  "INST-240912": [
    {
      t: "Aug 4, 08:12",
      ic: "intake",
      title: "Ticket created via API",
      by: "Videocon CRM",
      note: "SLA 24h · Pune 411014",
    },
    {
      t: "Aug 4, 08:12",
      ic: "ok",
      title: "Validation passed",
      by: "System",
      note: "All required fields present, pincode & phone valid",
    },
    {
      t: "Aug 4, 08:20",
      ic: "msg",
      title: "Slot request sent to customer",
      by: "WhatsApp",
      note: "Asked to pick a slot within 24h window",
    },
    {
      t: "Aug 4, 08:47",
      ic: "lock",
      title: "Slot confirmed & locked",
      by: "Anil Deshmukh",
      note: "Aug 5, 10:00–12:00",
    },
    {
      t: "Aug 4, 08:47",
      ic: "bell",
      title: "Notified 6 eligible technicians",
      by: "System",
      note: "Television · 411014 · bandwidth available",
    },
    {
      t: "Aug 4, 09:02",
      ic: "accept",
      title: "Accepted (first-accept)",
      by: "Sunil Pawar",
      note: "Product & customer details released",
    },
    {
      t: "Aug 5, 10:04",
      ic: "progress",
      title: "Job started",
      by: "Sunil Pawar",
      note: "Checked in at customer location",
    },
  ],
};

const channelOf = (vendor: string) =>
  vendor === "Electrolux"
    ? "manual entry"
    : vendor === "Kelvinator"
      ? "Excel upload"
      : "API";

/**
 * Derives a trail from the ticket's status. Mirrors the real flow: intake →
 * validation → slot request → slot locked → notify → accept → …
 */
export function timelineFor(t: Ticket): TimelineEvent[] {
  if (AUTHORED[t.id]) return AUTHORED[t.id];

  const trail: TimelineEvent[] = [
    {
      t: t.created,
      ic: "intake",
      title: `Ticket created via ${channelOf(t.vendor)}`,
      by: t.vendor,
      note: `${t.slaType} SLA · ${t.city} ${t.pincode}`,
    },
    {
      t: t.created,
      ic: "ok",
      title: "Validation passed",
      by: "System",
      note: "Required fields, pincode & phone valid",
    },
    {
      t: t.created,
      ic: "msg",
      title: "Slot request sent to customer",
      by: "WhatsApp",
      note: `Pick a slot within ${t.slaType} window`,
    },
  ];

  // No technician hears about a ticket until the customer locks a slot.
  if (t.status === "Slot Pending" || t.status === "New") return trail;

  trail.push(
    {
      t: t.created,
      ic: "lock",
      title: "Slot confirmed & locked",
      by: t.customer,
      note: t.slot,
    },
    {
      t: t.created,
      ic: "bell",
      title: "Notified eligible technicians",
      by: "System",
      note: `${t.category} · ${t.pincode}`,
    },
  );

  if (t.status === "Escalated") {
    trail.push({
      t: "—",
      ic: "bell",
      title: "Escalated to ASM",
      by: "System",
      note: "Unassigned within 4h of slot",
    });
    return trail;
  }

  if (t.tech !== "—") {
    trail.push({
      t: "—",
      ic: "accept",
      title: "Accepted (first-accept)",
      by: t.tech,
      note: "Product & customer details released",
    });
  }

  if (t.status === "In Progress") {
    trail.push({
      t: "—",
      ic: "progress",
      title: "Job started",
      by: t.tech,
      note: "Checked in at customer location",
    });
  }

  if (t.status === "AI Review") {
    trail.push(
      {
        t: "—",
        ic: "progress",
        title: "Proof submitted",
        by: t.tech,
        note: "Barcode, serial, photos, geo-tag",
      },
      {
        t: "—",
        ic: "bell",
        title: "AI flagged for review",
        by: "AI engine",
        note: "Routed to ASM · confidence below threshold",
      },
    );
  }

  if (t.status === "Closed") {
    trail.push(
      {
        t: "—",
        ic: "ok",
        title: "AI verification passed",
        by: "AI engine",
        note: "Serial & product matched",
      },
      {
        t: "—",
        ic: "ok",
        title: "Closed by customer",
        by: t.customer,
        note: "Feedback recorded · 5★",
      },
    );
  }

  if (t.status === "Force-Closed") {
    trail.push({
      t: "—",
      ic: "lock",
      title: "Force-closed by ASM",
      by: "Ravi Sharma",
      note: "No customer response 48h · attachments added",
    });
  }

  return trail;
}
