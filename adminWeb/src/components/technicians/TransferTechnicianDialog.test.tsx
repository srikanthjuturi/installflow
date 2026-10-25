import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FranchiseeOption } from "@/types/franchisee";
import type {
  Technician,
  TechnicianTransferInput,
  TechnicianTransferResult,
} from "@/types/technician";

const previewTransfer = vi.fn();
const transferTechnician = vi.fn();
vi.mock("@/services/technicians", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/technicians")>()),
  previewTransfer: (...a: unknown[]) => previewTransfer(...a),
  transferTechnician: (...a: unknown[]) => transferTechnician(...a),
}));

const listFranchiseeOptions = vi.fn();
const getFranchisee = vi.fn();
vi.mock("@/services/franchisees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/franchisees")>()),
  listFranchiseeOptions: (...a: unknown[]) => listFranchiseeOptions(...a),
  getFranchisee: (...a: unknown[]) => getFranchisee(...a),
}));

vi.mock("@/hooks/useAuth", () => ({
  useFeatureAccess: () => ({ loading: false, has: () => true }),
}));

// The real picker reads the geography master; the dialog only needs to know it
// was shown, what area it was told to limit itself to, and to be able to choose.
vi.mock("./CoverageFields", () => ({
  CoverageFields: ({
    onPincodes,
    limitTo,
  }: {
    onPincodes: (next: string[]) => void;
    limitTo?: { franchisee: string };
  }) => (
    <div data-testid="coverage-fields">
      <span data-testid="limit">{limitTo?.franchisee ?? "unlimited"}</span>
      <button type="button" onClick={() => onPincodes(["500033"])}>
        stub: choose 500033
      </button>
    </div>
  ),
}));

import { TransferTechnicianDialog } from "./TransferTechnicianDialog";

const tech = {
  id: "t-1",
  code: "TCH-4021",
  name: "Ravi Kumar",
  regionId: "r-1",
  franchiseeId: "f-home",
  franchiseeName: "Acme Appliances",
  franchiseeIsHome: true,
  createdAt: "2026-01-01T00:00:00Z",
} as Technician;

const home: FranchiseeOption = {
  id: "f-home",
  name: "Acme Appliances",
  code: "HOME",
  kind: "internal",
  isHome: true,
  isActive: true,
};
const sky: FranchiseeOption = {
  id: "f-sky",
  name: "SkyFix Services",
  code: "SKY",
  kind: "external",
  isHome: false,
  isActive: true,
};

function preview(o: Partial<TechnicianTransferResult> = {}): TechnicianTransferResult {
  return {
    dryRun: true,
    technicianId: "t-1",
    technicianCode: "TCH-4021",
    technicianName: "Ravi Kumar",
    technicianType: "freelancer",
    fromFranchiseeId: "f-home",
    fromFranchiseeName: "Acme Appliances",
    fromFranchiseeIsHome: true,
    toFranchiseeId: "f-sky",
    toFranchiseeName: "SkyFix Services",
    toFranchiseeIsHome: false,
    coverage: {
      source: "kept",
      kept: ["500031", "500032"],
      trimmed: ["500045"],
      added: [],
      after: ["500031", "500032"],
      keptCount: 2,
      trimmedCount: 1,
      addedCount: 0,
      regionBefore: "South",
      regionAfter: "South",
      regionChanged: false,
    },
    blockers: [],
    warnings: [],
    canTransfer: true,
    transfer: null,
    ...o,
  };
}

const nothingInside = preview({
  coverage: {
    source: "kept",
    kept: [],
    trimmed: ["500031", "500032", "500045"],
    added: [],
    after: [],
    keptCount: 0,
    trimmedCount: 3,
    addedCount: 0,
    regionBefore: "South",
    regionAfter: "South",
    regionChanged: false,
  },
  blockers: [
    {
      code: "PINCODE_OUTSIDE_FRANCHISEE",
      message:
        "None of TCH-4021's pincodes is inside SkyFix Services's area. Choose the pincodes SkyFix Services should serve.",
    },
  ],
  canTransfer: false,
});

function renderDialog(options: FranchiseeOption[] = [home, sky]) {
  listFranchiseeOptions.mockResolvedValue(options);
  getFranchisee.mockResolvedValue({ id: "f-sky", pincodeRanges: "500030-500040" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TransferTechnicianDialog open onOpenChange={vi.fn()} technician={tech} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const move = () => screen.getByRole("button", { name: "Move Ravi Kumar" });
const reasonBox = () => screen.getByLabelText(/Why is Ravi Kumar moving/);
const type = (text: string) =>
  fireEvent.change(reasonBox(), { target: { value: text } });

describe("TransferTechnicianDialog", () => {
  beforeEach(() => {
    previewTransfer.mockResolvedValue(preview());
    transferTechnician.mockResolvedValue(preview({ dryRun: false }));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens idle: Move is disabled and nothing has been checked", async () => {
    // Two franchisees to choose between, so nothing is picked for the person.
    renderDialog([home, sky, { ...sky, id: "f-bree", name: "Breeze Services" }]);
    expect(
      await screen.findByRole("dialog", {
        name: "Move Ravi Kumar to another franchisee",
      })
    ).toBeInTheDocument();
    expect(move()).toBeDisabled();
    expect(previewTransfer).not.toHaveBeenCalled();
    expect(screen.queryByText("Where they will work")).not.toBeInTheDocument();
  });

  it("fills in the only franchisee there is to move to, and previews it without a reason", async () => {
    renderDialog();
    expect(await screen.findByText("Where they will work")).toBeInTheDocument();
    await waitFor(() => expect(previewTransfer).toHaveBeenCalledTimes(1));
    expect(previewTransfer).toHaveBeenCalledWith({
      id: "t-1",
      body: { franchiseeId: "f-sky" },
    });
  });

  it("enables Move after a clean preview and a five-character reason", async () => {
    renderDialog();
    expect(
      await screen.findByText("Nothing is in the way. Ravi Kumar can move now.")
    ).toBeInTheDocument();
    expect(move()).toBeDisabled(); // no reason yet
    type("four");
    expect(move()).toBeDisabled();
    type("abcde");
    expect(move()).toBeEnabled();
  });

  it("shows what would stay and what would come off", async () => {
    renderDialog();
    expect(await screen.findByText("2 stay · 1 taken off")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Stays (2)" })).toHaveTextContent("500031");
    const off = screen.getByRole("list", { name: "Taken off (1)" });
    expect(off).toHaveTextContent("500045");
    expect(
      screen.getByText("Outside SkyFix Services's area, so these come off their coverage.")
    ).toBeInTheDocument();
  });

  it("renders a blocker as the server wrote it and keeps Move disabled", async () => {
    previewTransfer.mockResolvedValue(
      preview({
        blockers: [
          {
            code: "TECHNICIAN_HAS_OPEN_JOBS",
            message: "TCH-4021 still has 1 open job. Finish or reassign it first.",
            openJobs: 1,
          },
        ],
        canTransfer: false,
      })
    );
    renderDialog();
    expect(
      await screen.findByText(
        "TCH-4021 still has 1 open job. Finish or reassign it first."
      )
    ).toBeInTheDocument();
    type("a perfectly good reason");
    expect(move()).toBeDisabled();
    expect(
      screen.queryByText("Nothing is in the way. Ravi Kumar can move now.")
    ).not.toBeInTheDocument();
  });

  it("links a target with no admin to its page", async () => {
    previewTransfer.mockResolvedValue(
      preview({
        blockers: [
          {
            code: "FRANCHISEE_HAS_NO_ADMIN",
            message: "SkyFix Services has no active admin yet. Add one first.",
          },
        ],
        canTransfer: false,
      })
    );
    renderDialog();
    const link = await screen.findByRole("link", { name: "Open the franchisee" });
    expect(link).toHaveAttribute("href", "/franchisees/f-sky");
  });

  it("shows the server's warnings without blocking", async () => {
    previewTransfer.mockResolvedValue(
      preview({ warnings: ["A UPI change is waiting. It moves with them."] })
    );
    renderDialog();
    expect(
      await screen.findByText("A UPI change is waiting. It moves with them.")
    ).toBeInTheDocument();
    type("abcde");
    expect(move()).toBeEnabled();
  });

  it("names the region when it changes", async () => {
    previewTransfer.mockResolvedValue(
      preview({
        coverage: { ...preview().coverage, regionChanged: true, regionAfter: "West" },
      })
    );
    renderDialog();
    expect(await screen.findByText("They will work in West.")).toBeInTheDocument();
  });

  it("moves with { franchiseeId, reason } and NO pincodes key when none were chosen", async () => {
    renderDialog();
    await screen.findByText("Nothing is in the way. Ravi Kumar can move now.");
    type("  Ravi moved east  ");
    fireEvent.click(move());
    await waitFor(() => expect(transferTechnician).toHaveBeenCalledTimes(1));
    const arg = transferTechnician.mock.calls[0][0] as {
      id: string;
      body: TechnicianTransferInput;
    };
    expect(arg.id).toBe("t-1");
    expect(arg.body).toEqual({ franchiseeId: "f-sky", reason: "Ravi moved east" });
    expect("pincodes" in arg.body).toBe(false);
  });

  it("opens the picker by itself when nothing is inside the range, limited to the target's area", async () => {
    previewTransfer.mockResolvedValue(nothingInside);
    renderDialog();
    expect(
      await screen.findByText(/None of TCH-4021's pincodes is inside/)
    ).toBeInTheDocument();
    expect(await screen.findByTestId("coverage-fields")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("limit")).toHaveTextContent("SkyFix Services")
    );
    // There is no "use their current pincodes again" — they cannot work.
    expect(
      screen.queryByRole("button", { name: "Use their current pincodes again" })
    ).not.toBeInTheDocument();
    expect(move()).toBeDisabled();
  });

  it("re-previews with the pincodes chosen and sends them on Move", async () => {
    previewTransfer.mockImplementation(({ body }: { body: TechnicianTransferInput }) =>
      Promise.resolve(
        body.pincodes
          ? preview({
              coverage: {
                source: "supplied",
                kept: [],
                trimmed: ["500031", "500032", "500045"],
                added: ["500033"],
                after: ["500033"],
                keptCount: 0,
                trimmedCount: 3,
                addedCount: 1,
                regionBefore: "South",
                regionAfter: "South",
                regionChanged: false,
              },
            })
          : nothingInside
      )
    );
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "stub: choose 500033" }));

    await waitFor(() =>
      expect(previewTransfer).toHaveBeenCalledWith({
        id: "t-1",
        body: { franchiseeId: "f-sky", pincodes: ["500033"] },
      })
    );
    expect(await screen.findByText("0 stay · 3 taken off · 1 added")).toBeInTheDocument();
    // Having chosen some, the picker stays open (and may now be put away).
    expect(screen.getByTestId("coverage-fields")).toBeInTheDocument();

    type("Ravi moved east");
    await waitFor(() => expect(move()).toBeEnabled());
    fireEvent.click(move());
    await waitFor(() => expect(transferTechnician).toHaveBeenCalledTimes(1));
    expect(transferTechnician.mock.calls[0][0]).toEqual({
      id: "t-1",
      body: {
        franchiseeId: "f-sky",
        reason: "Ravi moved east",
        pincodes: ["500033"],
      },
    });
  });

  it("offers the picker on a clean preview too, and sends nothing unless something is chosen", async () => {
    renderDialog();
    await screen.findByText("Nothing is in the way. Ravi Kumar can move now.");
    fireEvent.click(
      screen.getByRole("button", { name: "Choose different pincodes instead" })
    );
    expect(await screen.findByTestId("coverage-fields")).toBeInTheDocument();
    type("Ravi moved east");
    await waitFor(() => expect(move()).toBeEnabled());
    fireEvent.click(move());
    await waitFor(() => expect(transferTechnician).toHaveBeenCalledTimes(1));
    expect(transferTechnician.mock.calls[0][0].body).toEqual({
      franchiseeId: "f-sky",
      reason: "Ravi moved east",
    });
  });

  it("says what went wrong when the move itself is refused, and previews again", async () => {
    transferTechnician.mockRejectedValue(
      new Error("TCH-4021 still has 1 open job. Finish or reassign it first.")
    );
    renderDialog();
    await screen.findByText("Nothing is in the way. Ravi Kumar can move now.");
    type("Ravi moved east");
    fireEvent.click(move());
    const alert = await screen.findByText(
      "TCH-4021 still has 1 open job. Finish or reassign it first."
    );
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    await waitFor(() => expect(previewTransfer.mock.calls.length).toBeGreaterThan(1));
  });

  it("asks again, with a way to retry, when the preview itself fails", async () => {
    previewTransfer.mockRejectedValue(new Error("boom"));
    renderDialog();
    expect(await screen.findByText("Couldn't check that move.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(move()).toBeDisabled();
  });

  it("lists nothing it should not: the technician's own franchisee is not a target", async () => {
    // Only the current franchisee exists: nothing to move to, nothing previewed.
    renderDialog([home]);
    await screen.findByRole("dialog");
    await waitFor(() => expect(listFranchiseeOptions).toHaveBeenCalled());
    expect(previewTransfer).not.toHaveBeenCalled();
    expect(move()).toBeDisabled();
  });
});
