import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PartRequest } from "@/types/parts";
import type { TicketDetail } from "@/types/ticket";

let handler = false;
vi.mock("@/hooks/useAuth", () => ({
  useFeatureAccess: () => ({
    loading: false,
    has: (key?: string) => !key || (key === "parts.handle" && handler),
  }),
}));

import { PartRequestsPanel } from "./PartRequestsPanel";

const request = (o: Partial<PartRequest> = {}): PartRequest => ({
  id: "r1",
  code: "RGT-SPR-0009",
  status: "requested",
  allowedActions: ["approve", "reject"],
  ticketId: "t1",
  ticketCode: "RGT-INST-0412",
  ticketStatus: "Awaiting Part",
  productLabel: "Acme FL-7",
  city: "Hyderabad",
  pincode: "500032",
  franchiseeId: "f1",
  franchiseeName: "SkyFix Services",
  technicianId: "tech1",
  technicianName: "Ravi Kumar",
  technicianPhone: null,
  sparePartId: null,
  partName: "HDMI cable",
  isOther: true,
  catalogueTarget: null,
  note: "cable is frayed",
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
  ...o,
});

const ticket = (partRequests: PartRequest[]) =>
  ({ partRequests }) as TicketDetail;

function renderPanel(partRequests: PartRequest[]) {
  return render(
    <MemoryRouter>
      <PartRequestsPanel ticket={ticket(partRequests)} />
    </MemoryRouter>
  );
}

describe("PartRequestsPanel", () => {
  afterEach(() => {
    cleanup();
    handler = false;
  });

  it("renders nothing when the ticket has no requests (a vendor's [])", () => {
    const { container } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the part, its status word, its code, the note and the trail", () => {
    renderPanel([request()]);
    expect(screen.getByText("Spare parts")).toBeInTheDocument();
    expect(screen.getByText("HDMI cable")).toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText(/RGT-SPR-0009 · raised/)).toBeInTheDocument();
    expect(screen.getByText(/cable is frayed/)).toBeInTheDocument();
    expect(screen.getByText(/Raised by Ravi Kumar/)).toBeInTheDocument();
  });

  it("says Photo on record when a return carries one — and does not draw it", () => {
    renderPanel([
      request({
        status: "returned",
        decidedAt: "2026-10-15T06:00:00Z",
        decidedBy: "Meena R",
        issuedAt: "2026-10-15T07:00:00Z",
        issuedBy: "Arjun",
        returnedAt: "2026-10-15T08:00:00Z",
        returnedBy: "Arjun",
        returnPhotoUrl: "https://example.test/p.jpg",
      }),
    ]);
    expect(screen.getByText("Photo on record")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Old part received by Arjun/)).toBeInTheDocument();
  });

  it("reads 'Rejected after approval' with the cancellation line (R2)", () => {
    renderPanel([
      request({
        status: "rejected",
        rejectedAfterApproval: true,
        decidedAt: "2026-10-15T06:00:00Z",
        decidedBy: "Meena R",
        rejectReason: "Out of stock",
      }),
    ]);
    expect(screen.getByText("Rejected after approval")).toBeInTheDocument();
    expect(
      screen.getByText(/Cancelled after approval by Meena R/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Out of stock/)).toBeInTheDocument();
  });

  it("offers Open request ONLY to a handler — never on the staff console (R4)", () => {
    handler = false;
    const { unmount } = renderPanel([request()]);
    expect(screen.queryByText("Open request")).toBeNull();
    unmount();

    handler = true;
    renderPanel([request()]);
    const link = screen.getByText("Open request");
    expect(link).toHaveAttribute("href", "/franchise/parts/requests/r1");
  });
});
