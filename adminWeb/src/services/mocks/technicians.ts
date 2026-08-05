import type { Technician } from "@/types";

export const TECHNICIANS: Technician[] = [
  { id: "TCH-4021", name: "Sunil Pawar", phone: "+91 98220 66301", cats: ["Television", "Air Conditioner"], pincodes: "411014, 411028, 411045", bwUsed: 3, bwTotal: 5, rating: 4.7, status: "Active", jobs: 284, cancels: 4, penalty: 900, bonus: 1500, joined: "Mar 2023" },
  { id: "TCH-4033", name: "Imran Shaikh", phone: "+91 90110 44872", cats: ["Washing Machine", "Refrigerator", "Television"], pincodes: "411007, 411019, 411057", bwUsed: 4, bwTotal: 6, rating: 4.5, status: "Active", jobs: 341, cancels: 9, penalty: 2400, bonus: 800, joined: "Jan 2022" },
  { id: "TCH-4048", name: "Ganesh More", phone: "+91 98765 11209", cats: ["Microwave", "Washing Machine", "Television"], pincodes: "411001, 411019, 411030", bwUsed: 2, bwTotal: 5, rating: 4.8, status: "Active", jobs: 198, cancels: 2, penalty: 300, bonus: 2100, joined: "Aug 2023" },
  { id: "TCH-4055", name: "Prakash Jadhav", phone: "+91 89990 33741", cats: ["Air Conditioner", "Refrigerator"], pincodes: "411045, 411046, 411057", bwUsed: 5, bwTotal: 5, rating: 4.2, status: "Active", jobs: 412, cancels: 14, penalty: 4200, bonus: 600, joined: "Jun 2021" },
  { id: "TCH-4067", name: "Santosh Gaikwad", phone: "+91 70301 99820", cats: ["Television", "Microwave"], pincodes: "411028, 411038", bwUsed: 1, bwTotal: 4, rating: 4.6, status: "Active", jobs: 156, cancels: 3, penalty: 450, bonus: 1200, joined: "Nov 2023" },
  { id: "TCH-4072", name: "Ramesh Kadam", phone: "+91 96570 28810", cats: ["Refrigerator", "Washing Machine"], pincodes: "411018, 411021", bwUsed: 0, bwTotal: 5, rating: 3.9, status: "Inactive", jobs: 88, cancels: 11, penalty: 3600, bonus: 0, joined: "Feb 2024" },
  { id: "TCH-4080", name: "Vijay Sawant", phone: "+91 88888 90012", cats: ["Television", "Air Conditioner", "Microwave"], pincodes: "411001, 411014, 411030", bwUsed: 3, bwTotal: 6, rating: 4.4, status: "Active", jobs: 263, cancels: 6, penalty: 1500, bonus: 900, joined: "May 2022" },
  { id: "TCH-4091", name: "Amit Borkar", phone: "+91 99000 71265", cats: ["Washing Machine", "Microwave"], pincodes: "411038, 411057", bwUsed: 2, bwTotal: 4, rating: 4.1, status: "Active", jobs: 120, cancels: 8, penalty: 2100, bonus: 300, joined: "Jul 2023" },
];

/** Recent jobs shown on a technician's profile. */
export const JOB_HISTORY = [
  { id: "INST-240951", cat: "Washing Machine", date: "Aug 3", outcome: "Closed" as const },
  { id: "INST-240889", cat: "Television", date: "Aug 2", outcome: "Cancelled" as const },
  { id: "INST-240810", cat: "Air Conditioner", date: "Aug 1", outcome: "Closed" as const },
  { id: "INST-240770", cat: "Television", date: "Jul 30", outcome: "Closed" as const },
];
