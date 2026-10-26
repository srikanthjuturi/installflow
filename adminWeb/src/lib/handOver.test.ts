import { describe, expect, it } from "vitest";
import {
  CLOSED_WINDOW_NOTE,
  blockerSentence,
  canHandOver,
  dialogDefault,
  handOverToast,
  handedByLabel,
  isHandable,
  optionLabel,
  optionWarning,
  reasonError,
} from "./handOver";
import {
  HANDOVER_TICKET_STATUSES,
  TICKET_STATUSES,
  type FranchiseeOption,
  type TicketStatus,
} from "@/types/ticket";

const yes = (key: string) => key === "jobs.assign";
const no = () => false;

const open = (status: TicketStatus, technicianId: string | null = null) => ({
  status,
  technicianId,
});

function option(over: Partial<FranchiseeOption> = {}): FranchiseeOption {
  return {
    id: "f1",
    name: "Acme Secunderabad",
    code: "SEC",
    isHome: false,
    kind: "internal",
    isCurrent: false,
    ownsPincode: false,
    eligibleTechnicians: 3,
    onlineTechnicians: 2,
    ...over,
  };
}

describe("canHandOver", () => {
  it.each(["New", "Slot Pending", "Escalated"] as const)(
    "is offered on an unassigned %s ticket to a holder of jobs.assign",
    (status) => {
      expect(canHandOver(open(status), yes)).toBe(true);
    }
  );

  it("is not offered once a technician holds it, whatever the status", () => {
    expect(canHandOver(open("New", "t1"), yes)).toBe(false);
    expect(canHandOver(open("Escalated", "t1"), yes)).toBe(false);
  });

  it.each(["Assigned", "In Progress", "Awaiting Part", "Closed"] as const)(
    "is not offered on %s",
    (status) => {
      expect(canHandOver(open(status), yes)).toBe(false);
    }
  );

  it("needs jobs.assign", () => {
    expect(canHandOver(open("New"), no)).toBe(false);
  });
});

describe("isHandable", () => {
  it("mirrors the server's three statuses, table-driven", () => {
    for (const status of TICKET_STATUSES) {
      expect(isHandable(open(status))).toBe(
        (HANDOVER_TICKET_STATUSES as readonly string[]).includes(status)
      );
    }
    expect([...HANDOVER_TICKET_STATUSES]).toEqual([
      "New",
      "Slot Pending",
      "Escalated",
    ]);
  });
});

describe("optionLabel", () => {
  it("counts eligible and online", () => {
    expect(optionLabel({ eligibleTechnicians: 3, onlineTechnicians: 2 })).toBe(
      "3 eligible · 2 online"
    );
  });
  it("is just '0 eligible' for nobody", () => {
    expect(optionLabel({ eligibleTechnicians: 0, onlineTechnicians: 0 })).toBe(
      "0 eligible"
    );
  });
  it("still says online when some are eligible but none are", () => {
    expect(optionLabel({ eligibleTechnicians: 1, onlineTechnicians: 0 })).toBe(
      "1 eligible · 0 online"
    );
  });
});

describe("optionWarning", () => {
  const open_ = { status: "Slot Pending" as TicketStatus, slotOffered: true };

  it("warns, naming the franchisee, when nobody is eligible", () => {
    expect(
      optionWarning(option({ eligibleTechnicians: 0, onlineTechnicians: 0 }), open_)
    ).toBe(
      "Nobody at Acme Secunderabad can take this job right now. You can still hand it over, and then assign someone by hand."
    );
  });

  it("is softer when some are eligible and none online", () => {
    expect(
      optionWarning(option({ eligibleTechnicians: 2, onlineTechnicians: 0 }), open_)
    ).toBe("2 eligible, but none are online. They'll see it when they go online.");
  });

  it("is null when people are eligible and online", () => {
    expect(optionWarning(option(), open_)).toBeNull();
  });

  it("adds the time-passed note for an escalated ticket whose window closed", () => {
    const closed = { status: "Escalated" as TicketStatus, slotOffered: false };
    expect(optionWarning(option(), closed)).toBe(CLOSED_WINDOW_NOTE);
    expect(
      optionWarning(option({ eligibleTechnicians: 0, onlineTechnicians: 0 }), closed)
    ).toContain(CLOSED_WINDOW_NOTE);
  });

  it("does not add it for an escalated ticket the pool can still offer", () => {
    expect(
      optionWarning(option(), { status: "Escalated", slotOffered: true })
    ).toBeNull();
  });
});

describe("reasonError", () => {
  it("asks for a reason when empty or too short", () => {
    expect(reasonError("")).toBe("Say why you're handing it over.");
    expect(reasonError("  ab ")).toBe("Say why you're handing it over.");
  });
  it("accepts three characters", () => {
    expect(reasonError("abc")).toBeNull();
  });
  it("refuses over 255 characters, and trims before counting", () => {
    expect(reasonError("x".repeat(256))).toBe("Keep it under 255 characters.");
    expect(reasonError("x".repeat(255))).toBeNull();
    expect(reasonError(`  ${"x".repeat(255)}  `)).toBeNull();
  });
});

describe("dialogDefault", () => {
  it("preselects nobody, even when one option has technicians", () => {
    const d = dialogDefault([option({ id: "a" }), option({ id: "b" })]);
    expect(d.franchiseeId).toBe("");
    expect(d.reason).toBe("");
  });
  it("disables the current franchisee and only that one", () => {
    const d = dialogDefault([
      option({ id: "cur", isCurrent: true }),
      option({ id: "other" }),
    ]);
    expect(d.rows.map((r) => [r.id, r.disabled])).toEqual([
      ["cur", true],
      ["other", false],
    ]);
  });
});

describe("blockerSentence", () => {
  it("says the ticket has a technician", () => {
    expect(
      blockerSentence("TICKET_ASSIGNED", { code: "ACM-1", status: "Assigned" })
    ).toBe("ACM-1 already has a technician. Cancel it from them first, or re-assign it.");
  });
  it("uses the server's sentence for a settled ticket", () => {
    expect(
      blockerSentence("TICKET_NOT_ASSIGNABLE", { code: "ACM-1", status: "Closed" })
    ).toBe("This ticket is Closed and can no longer be moved.");
  });
  it("is null when nothing blocks", () => {
    expect(blockerSentence(null, { code: "ACM-1", status: "New" })).toBeNull();
  });
});

describe("handOverToast / handedByLabel", () => {
  it("counts the phones that rang", () => {
    expect(
      handOverToast("ACM-1", "Acme", { notified: 2, backInPool: false, wasEscalated: false })
    ).toBe("ACM-1 handed to Acme. 2 technicians notified.");
    expect(
      handOverToast("ACM-1", "Acme", { notified: 1, backInPool: false, wasEscalated: false })
    ).toBe("ACM-1 handed to Acme. 1 technician notified.");
  });
  it("says so when an escalated ticket could not go back to the pool", () => {
    expect(
      handOverToast("ACM-1", "Acme", { notified: 0, backInPool: false, wasEscalated: true })
    ).toBe("ACM-1 handed to Acme. It isn't in the pool — its time has passed.");
  });
  it("labels the assign page line", () => {
    expect(handedByLabel("Acme Secunderabad")).toBe(
      "Handed over to Acme Secunderabad. Pincode coverage isn't required for this job."
    );
  });
});
