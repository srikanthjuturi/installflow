import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/utils/datetime";
import { PART_REQUEST_STATUSES, type PartRequest } from "@/types/parts";
import {
  ALL_STATUSES_PARAM,
  DEFAULT_QUEUE_STATUSES,
  PART_ACTION,
  PART_STATUS_CLASS,
  PART_STATUS_LABEL,
  QUEUE_PILLS,
  actionsFor,
  offersAddToCatalogue,
  partStatusClass,
  partStatusLabel,
  trailLines,
} from "./partStatus";

/**
 * Task 13 §6 — the request vocabulary is pure, so its words, classes, action
 * order and trail wording are pinned here. All wording is §5.10 PROPOSED copy.
 */

const base: PartRequest = {
  id: "r1",
  code: "RGT-SPR-0009",
  status: "requested",
  allowedActions: ["approve", "reject"],
  ticketId: "t1",
  ticketCode: "RGT-INST-0412",
  ticketStatus: "Awaiting Part",
  productLabel: "Acme FL-7 (7 kg)",
  city: "Hyderabad",
  pincode: "500032",
  franchiseeId: "f1",
  franchiseeName: "SkyFix Services",
  technicianId: "tech1",
  technicianName: "Ravi Kumar",
  technicianPhone: "+919822011223",
  sparePartId: null,
  partName: "HDMI cable",
  isOther: true,
  catalogueTarget: { nodeId: "n1", nodeName: "Television" },
  note: null,
  createdAt: "2026-10-15T05:30:00Z",
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  rejectedAfterApproval: false,
  issuedAt: null,
  issuedBy: null,
  issueNote: null,
  returnedAt: null,
  returnedBy: null,
  returnNote: null,
  returnPhotoUrl: null,
};

const req = (o: Partial<PartRequest>): PartRequest => ({ ...base, ...o });

describe("status vocabulary", () => {
  it("gives every status a label and a static class", () => {
    for (const s of PART_REQUEST_STATUSES) {
      expect(PART_STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(PART_STATUS_CLASS[s]).toMatch(/^bg-\S+ text-\S+$/);
    }
  });

  it("uses the §5.7 classes", () => {
    expect(PART_STATUS_CLASS.requested).toBe("bg-info-bg text-info");
    expect(PART_STATUS_CLASS.approved).toBe("bg-status-assigned-bg text-brand-400");
    expect(PART_STATUS_CLASS.issued).toBe("bg-ok-bg text-ok");
    expect(PART_STATUS_CLASS.returned).toBe("bg-surface-3 text-ink-2");
    expect(PART_STATUS_CLASS.rejected).toBe("bg-warn-bg text-warn");
  });

  it("falls back to a neutral class for a status this build has never heard of", () => {
    expect(partStatusClass("on_hold")).toBe("bg-surface-3 text-ink-2");
  });

  it("reads 'Rejected after approval' ONLY for a rejection with that flag (R2)", () => {
    expect(partStatusLabel(req({ status: "rejected" }))).toBe("Rejected");
    expect(
      partStatusLabel(req({ status: "rejected", rejectedAfterApproval: true }))
    ).toBe("Rejected after approval");
    // The flag means nothing on a row that is not rejected.
    expect(
      partStatusLabel(req({ status: "approved", rejectedAfterApproval: true }))
    ).toBe("Approved");
  });
});

describe("actionsFor", () => {
  it("returns the server's allowed actions in the fixed order, forward steps first", () => {
    expect(actionsFor({ allowedActions: ["reject", "issue"] }, true)).toEqual([
      "issue",
      "reject",
    ]);
    expect(actionsFor({ allowedActions: ["reject", "approve"] }, true)).toEqual([
      "approve",
      "reject",
    ]);
  });

  it("offers Reject beside Mark issued on an approved request (R2)", () => {
    expect(actionsFor({ allowedActions: ["issue", "reject"] }, true)).toEqual([
      "issue",
      "reject",
    ]);
  });

  it("offers only Log return on an issued request", () => {
    expect(actionsFor({ allowedActions: ["return"] }, true)).toEqual(["return"]);
  });

  it("drops an action word this build cannot draw", () => {
    expect(
      actionsFor({ allowedActions: ["approve", "escalate", "reject"] }, true)
    ).toEqual(["approve", "reject"]);
  });

  it("returns [] for somebody who cannot handle parts", () => {
    expect(actionsFor({ allowedActions: ["approve", "reject"] }, false)).toEqual([]);
  });

  it("labels the four actions as §5.10 words them, Reject as the danger one", () => {
    expect(PART_ACTION.approve.label).toBe("Approve");
    expect(PART_ACTION.issue.label).toBe("Mark issued");
    expect(PART_ACTION.return.label).toBe("Log return");
    expect(PART_ACTION.reject.label).toBe("Reject");
    expect(PART_ACTION.reject.danger).toBe(true);
  });
});

describe("offersAddToCatalogue", () => {
  it("is true exactly when the server named a catalogue target", () => {
    expect(offersAddToCatalogue({ catalogueTarget: { nodeId: "n", nodeName: "TV" } })).toBe(
      true
    );
    expect(offersAddToCatalogue({ catalogueTarget: null })).toBe(false);
  });
});

describe("queue statuses", () => {
  it("defaults to the desk: requested, approved, issued (D22)", () => {
    expect([...DEFAULT_QUEUE_STATUSES]).toEqual(["requested", "approved", "issued"]);
  });

  it("offers a pill per status then 'All', whose value is every status as a comma-set", () => {
    expect(QUEUE_PILLS.map((p) => p.label)).toEqual([
      "Requested",
      "Approved",
      "Issued",
      "Returned",
      "Rejected",
      "All",
    ]);
    expect(ALL_STATUSES_PARAM).toBe("requested,approved,issued,returned,rejected");
    expect(QUEUE_PILLS.at(-1)?.value).toBe(ALL_STATUSES_PARAM);
  });
});

describe("trailLines", () => {
  const at = "2026-10-15T05:30:00Z";
  const when = formatDateTime(at);

  it("starts with who raised it", () => {
    expect(trailLines(req({}))).toEqual([
      { key: "raised", text: `Raised by Ravi Kumar · ${when}` },
    ]);
  });

  it("runs raised → approved → issued → returned for a returned request", () => {
    const lines = trailLines(
      req({
        status: "returned",
        decidedAt: at,
        decidedBy: "Meena R",
        issuedAt: at,
        issuedBy: "Arjun",
        returnedAt: at,
        returnedBy: "Arjun",
      })
    );
    expect(lines.map((l) => l.key)).toEqual([
      "raised",
      "approved",
      "issued",
      "returned",
    ]);
    expect(lines[1].text).toBe(`Approved by Meena R · ${when}`);
    expect(lines[2].text).toBe(`Issued by Arjun · ${when}`);
    expect(lines[3].text).toBe(`Old part received by Arjun · ${when}`);
  });

  it("runs raised → rejected, with the reason, for a plain rejection", () => {
    const lines = trailLines(
      req({
        status: "rejected",
        decidedAt: at,
        decidedBy: "Meena R",
        rejectReason: "Not under warranty",
      })
    );
    expect(lines.map((l) => l.key)).toEqual(["raised", "rejected"]);
    expect(lines[1].text).toBe(`Rejected by Meena R · ${when} — Not under warranty`);
  });

  it("runs raised → cancelled after approval, with the reason, for R2", () => {
    const lines = trailLines(
      req({
        status: "rejected",
        rejectedAfterApproval: true,
        decidedAt: at,
        decidedBy: "Meena R",
        rejectReason: "Part is out of stock",
      })
    );
    expect(lines.map((l) => l.key)).toEqual(["raised", "rejected"]);
    expect(lines[1].text).toBe(
      `Cancelled after approval by Meena R · ${when} — Part is out of stock`
    );
  });

  it("never invents a step that has not happened", () => {
    expect(trailLines(req({ status: "approved", decidedAt: at, decidedBy: "M" })).map((l) => l.key)).toEqual([
      "raised",
      "approved",
    ]);
  });
});
