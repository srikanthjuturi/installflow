import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Technician, TechnicianTransfer } from "@/types/technician";

const getTransfers = vi.fn();
vi.mock("@/services/technicians", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/technicians")>()),
  getTransfers: (...a: unknown[]) => getTransfers(...a),
}));

import { TechTransferHistory } from "./TechTransferHistory";

const tech = {
  id: "t-1",
  franchiseeName: "SkyFix Services",
  createdAt: "2026-01-05T10:00:00Z",
} as Technician;

const row: TechnicianTransfer = {
  id: "x",
  at: "2026-10-16T08:00:00Z",
  technicianId: "t-1",
  fromFranchiseeId: "h",
  fromFranchiseeName: "Acme Appliances",
  toFranchiseeId: "s",
  toFranchiseeName: "SkyFix Services",
  technicianType: "freelancer",
  reason: "Ravi moved east",
  byUserId: "u",
  byName: "Nisha Rao",
  kept: ["500031", "500032"],
  trimmed: ["500045"],
  added: [],
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TechTransferHistory tech={tech} />
    </QueryClientProvider>
  );
}

describe("TechTransferHistory", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a skeleton while it loads", () => {
    getTransfers.mockReturnValue(new Promise(() => undefined));
    const { container } = renderCard();
    expect(screen.getByText("Transfer history")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("says never moved, with the franchisee and the day they joined", async () => {
    getTransfers.mockResolvedValue([]);
    renderCard();
    expect(
      await screen.findByText("Never moved. Works for SkyFix Services since 05-01-2026.")
    ).toBeInTheDocument();
  });

  it("writes one line per move with the reason and what happened to the pincodes", async () => {
    getTransfers.mockResolvedValue([row]);
    renderCard();
    expect(
      await screen.findByText("16-10-2026 · Acme Appliances → SkyFix Services · by Nisha Rao")
    ).toBeInTheDocument();
    expect(
      screen.getByText("“Ravi moved east” · 2 pincodes stayed · 1 taken off (500045)")
    ).toBeInTheDocument();
  });

  it("offers Retry when it cannot load", async () => {
    getTransfers.mockRejectedValue(new Error("down"));
    renderCard();
    expect(
      await screen.findByText("Couldn't load the transfer history")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
