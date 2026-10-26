import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartRequest } from "@/types/parts";

const uploadImage = vi.fn();
vi.mock("@/services/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/uploads")>()),
  uploadImage: (...a: unknown[]) => uploadImage(...a),
}));

const toastAdd = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: { add: (...a: unknown[]) => toastAdd(...a) },
}));

import { ApprovePartDialog } from "./ApprovePartDialog";
import { RejectPartDialog } from "./RejectPartDialog";
import { ReturnPartDialog } from "./ReturnPartDialog";

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
  ...o,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApprovePartDialog", () => {
  it("offers 'Add to the parts list' for an Other request, UNTICKED by default", () => {
    const onConfirm = vi.fn();
    render(
      <ApprovePartDialog
        open
        onOpenChange={vi.fn()}
        request={request()}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    expect(screen.getByText("Approve HDMI cable for RGT-INST-0412?")).toBeInTheDocument();
    expect(screen.getByText(/Ravi Kumar is told it's approved/)).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Add "HDMI cable" to Television's parts list/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith({ addToCatalogue: false });
  });

  it("sends addToCatalogue true once ticked", () => {
    const onConfirm = vi.fn();
    render(
      <ApprovePartDialog
        open
        onOpenChange={vi.fn()}
        request={request()}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledWith({ addToCatalogue: true });
  });

  it("draws no checkbox for a request that already names a catalogue part", () => {
    render(
      <ApprovePartDialog
        open
        onOpenChange={vi.fn()}
        request={request({ catalogueTarget: null, isOther: false })}
        onConfirm={vi.fn()}
        isPending={false}
      />
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("RejectPartDialog", () => {
  it("rejects a requested part with a required reason", async () => {
    const onConfirm = vi.fn();
    render(
      <RejectPartDialog
        open
        onOpenChange={vi.fn()}
        request={request()}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    expect(screen.getByText("Reject HDMI cable?")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar sees your reason.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: "Not under warranty" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({ reason: "Not under warranty" });
  });

  it("is titled 'Cancel the approved …' on an approved request, button 'Cancel approval' (R2)", () => {
    render(
      <RejectPartDialog
        open
        onOpenChange={vi.fn()}
        request={request({ status: "approved", allowedActions: ["issue", "reject"] })}
        onConfirm={vi.fn()}
        isPending={false}
      />
    );
    expect(screen.getByText("Cancel the approved HDMI cable?")).toBeInTheDocument();
    expect(
      screen.getByText("Ravi Kumar was told it was coming — they see your reason.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel approval" })).toBeInTheDocument();
  });
});

describe("ReturnPartDialog", () => {
  beforeEach(() => {
    // jsdom has no object URLs; the picker mints one per chosen file.
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  const photo = () => new File(["x"], "old-part.jpg", { type: "image/jpeg" });

  function chooseFile() {
    const input = document.querySelector<HTMLInputElement>("#return-part-photo")!;
    fireEvent.change(input, { target: { files: [photo()] } });
  }

  it("logs a return with no photo — and uploads nothing", async () => {
    const onConfirm = vi.fn();
    render(
      <ReturnPartDialog
        open
        onOpenChange={vi.fn()}
        request={request({ status: "issued", allowedActions: ["return"] })}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Log return" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({ note: "", photoBlobName: null });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("uploads the photo FIRST (kind=attachment) and then logs with the blob name", async () => {
    uploadImage.mockResolvedValue("attachment/c1/abc.jpg");
    const onConfirm = vi.fn();
    render(
      <ReturnPartDialog
        open
        onOpenChange={vi.fn()}
        request={request({ status: "issued", allowedActions: ["return"] })}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    chooseFile();
    expect(await screen.findByText("old-part.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log return" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(uploadImage).toHaveBeenCalledWith(expect.any(File), "attachment");
    expect(onConfirm).toHaveBeenCalledWith({
      note: "",
      photoBlobName: "attachment/c1/abc.jpg",
    });
    // The order is the point: upload resolved before the return was logged.
    expect(uploadImage.mock.invocationCallOrder[0]).toBeLessThan(
      onConfirm.mock.invocationCallOrder[0]
    );
  });

  it("toasts, logs NOTHING and keeps the file when the upload fails", async () => {
    uploadImage.mockRejectedValue(new Error("boom"));
    const onConfirm = vi.fn();
    render(
      <ReturnPartDialog
        open
        onOpenChange={vi.fn()}
        request={request({ status: "issued", allowedActions: ["return"] })}
        onConfirm={onConfirm}
        isPending={false}
      />
    );
    chooseFile();
    fireEvent.click(await screen.findByRole("button", { name: "Log return" }));
    await waitFor(() => expect(toastAdd).toHaveBeenCalledTimes(1));
    expect(toastAdd.mock.calls[0][0].title).toBe("Couldn't upload the photo");
    expect(onConfirm).not.toHaveBeenCalled();
    // The dialog stands, with the file still chosen.
    expect(screen.getByText("old-part.jpg")).toBeInTheDocument();
  });
});
