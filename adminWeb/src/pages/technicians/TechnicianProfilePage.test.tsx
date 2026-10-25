import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Technician } from "@/types/technician";

let granted: string[] = [];
let tech: Partial<Technician> = {};
vi.mock("@/hooks/useAuth", () => ({
  useFeatureAccess: () => ({
    loading: false,
    has: (key?: string) => !key || granted.includes(key),
  }),
  useMe: () => ({ data: { role: "national_head" } }),
}));

vi.mock("@/hooks/useTechnicians", () => ({
  useTechnician: () => ({
    data: tech,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useTickets", () => ({
  useTechnicianJobs: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}));
vi.mock("@/store/recentlySeen", () => ({ useRecordRecentlySeen: () => undefined }));

// Everything below the page is somebody else's concern; stubs keep this to the
// one question — who is offered the Move button, and where the history sits.
vi.mock("@/components/shared/PageMeta", () => ({ PageMeta: () => null }));
vi.mock("@/components/technicians/TechnicianFormDialog", () => ({ TechnicianFormDialog: () => null }));
vi.mock("@/components/technicians/DeleteTechnicianDialog", () => ({ DeleteTechnicianDialog: () => null }));
vi.mock("@/components/technicians/UpiChangePanel", () => ({ UpiChangePanel: () => null }));
vi.mock("@/components/technicians/BaseLocationPanel", () => ({ BaseLocationPanel: () => null }));
vi.mock("@/components/technicians/DownloadStatementCard", () => ({ DownloadStatementCard: () => null }));
vi.mock("@/components/technicians/JobHistoryTable", () => ({ JobHistoryTable: () => null }));
vi.mock("@/components/technicians/TechOnboardingCard", () => ({
  TechOnboardingCard: () => null,
  TechOnboardingCardSkeleton: () => null,
}));
vi.mock("@/components/technicians/TechProfileHeader", () => ({
  TechProfileHeader: () => null,
  TechStats: () => null,
}));
vi.mock("@/components/technicians/TechTransferHistory", () => ({
  TechTransferHistory: () => <div data-testid="history" />,
}));
vi.mock("@/components/technicians/TransferTechnicianDialog", () => ({
  TransferTechnicianDialog: ({ open }: { open: boolean }) => (
    <div data-testid="move-dialog">{open ? "open" : "closed"}</div>
  ),
}));

import TechnicianProfilePage from "./TechnicianProfilePage";

function renderPage(features: string[], overrides: Partial<Technician> = {}) {
  granted = features;
  tech = {
    id: "t-1",
    name: "Ravi Kumar",
    code: "TCH-4021",
    phone: "+919876543210",
    franchiseeName: "SkyFix Services",
    franchiseeIsHome: false,
    technicianType: "freelancer",
    canManage: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  return render(
    <MemoryRouter initialEntries={["/technicians/t-1"]}>
      <Routes>
        <Route path="/technicians/:id" element={<TechnicianProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

const MOVE = "Move to another franchisee";

describe("TechnicianProfilePage — moving a technician", () => {
  afterEach(cleanup);

  it("offers no Move button without franchisees.manage", () => {
    renderPage(["technicians.view", "technicians.edit"]);
    expect(screen.queryByRole("button", { name: MOVE })).not.toBeInTheDocument();
    // They can still edit — the button is its own gate, not a side effect.
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("offers it with franchisees.manage", () => {
    renderPage(["technicians.view", "technicians.edit", "franchisees.manage"]);
    expect(screen.getByRole("button", { name: MOVE })).toBeInTheDocument();
  });

  it("offers it on a technician the viewer cannot manage (canManage is false)", () => {
    renderPage(["technicians.view", "franchisees.manage"], { canManage: false });
    expect(screen.getByRole("button", { name: MOVE })).toBeInTheDocument();
    // The ordinary row writes stay hidden, and the notice says whose they are.
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.getByText("Run by SkyFix Services.")).toBeInTheDocument();
  });

  it("mounts the dialog only for someone who may use it", () => {
    renderPage(["technicians.view", "technicians.edit"]);
    expect(screen.queryByTestId("move-dialog")).not.toBeInTheDocument();
    cleanup();
    renderPage(["technicians.view", "franchisees.manage"]);
    expect(screen.getByTestId("move-dialog")).toHaveTextContent("closed");
  });

  it("shows the transfer history to anyone who can see the technician", () => {
    renderPage(["technicians.view"]);
    expect(screen.getByTestId("history")).toBeInTheDocument();
  });
});
