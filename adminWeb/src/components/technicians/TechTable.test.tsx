import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FranchiseeOption,
} from "@/types/franchisee";
import type { Technician, TechnicianRow } from "@/types/technician";
import { TechTable } from "./TechTable";

function tech(overrides: Partial<Technician> = {}): Technician {
  return {
    registered: true,
    id: "t-1",
    membershipId: "m-1",
    userId: "u-1",
    code: "TCH-4001",
    name: "Ravi Kumar",
    phone: "+919876543210",
    profileImageUrl: null,
    isActive: true,
    status: "active",
    regionId: "r-1",
    regionName: "South",
    subcategories: [],
    pincodes: ["500030"],
    dailyJobCap: null,
    upiId: null,
    upiName: null,
    upiChangePending: false,
    bwUsed: 0,
    acceptingWork: true,
    online: true,
    rating: null,
    jobsCompleted: null,
    jobsCancelled: null,
    onTimePct: null,
    onboarding: {
      mode: "direct",
      registeredBy: "manager",
      appointedByName: null,
      appointedByEmail: null,
      appointedByRole: null,
      appointedByRoleLabel: null,
      appointedAt: "2026-01-01T00:00:00Z",
      registeredAt: "2026-01-01T00:00:00Z",
    },
    franchiseeId: "f-1",
    franchiseeName: "Breeze Services",
    franchiseeIsHome: false,
    technicianType: "freelancer",
    canManage: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function option(specific: Partial<FranchiseeOption> = {}): FranchiseeOption {
  return {
    id: "f-home",
    name: "Demo Services",
    code: "HOME",
    kind: "internal",
    isHome: true,
    isActive: true,
    ...specific,
  };
}

function renderTable(
  rows: TechnicianRow[],
  franchisees: FranchiseeOption[],
  canProps: Partial<{
    canManageInvites: boolean;
    canEditTechnician: boolean;
    canSendAppLink: boolean;
  }> = {}
) {
  return render(
    <MemoryRouter>
      <TechTable
        rows={rows}
        meta={{
          page: 1,
          limit: 20,
          totalRecords: rows.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        }}
        params={{}}
        onParams={vi.fn()}
        regions={[]}
        districts={[]}
        franchisees={franchisees}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManageInvites={canProps.canManageInvites ?? true}
        canEditTechnician={canProps.canEditTechnician ?? true}
        onEditTechnician={vi.fn()}
        canSendAppLink={canProps.canSendAppLink ?? true}
        onSendAppLink={vi.fn()}
        onDeleteTechnician={vi.fn()}
        onResend={vi.fn()}
        onCancel={vi.fn()}
        onCopyLink={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("TechTable", () => {
  afterEach(cleanup);
  it("shows no row writes for a technician the caller cannot manage", () => {
    renderTable([tech({ canManage: false })], [option()]);
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: /^(Send app link|Remove)/ })
    ).toHaveLength(0);
    // The Edit link rides on the same server fact.
    expect(screen.queryAllByRole("button", { name: /^Edit / })).toHaveLength(0);
  });

  it("shows the row writes once canManage is true, same can* props", () => {
    renderTable([tech()], [option()]);
    expect(screen.getAllByRole("button", { name: /^Edit/ }).length).toBeGreaterThan(0);
  });

  it("keeps the Franchisee filter out when there is one franchisee", () => {
    renderTable([tech()], [option({})]);
    expect(screen.queryAllByLabelText("Franchisee")).toHaveLength(0);
    // Still a column — only the filter is withheld.
    expect(screen.getAllByText("Franchisee").length).toBeGreaterThan(0);
  });

  it("offers the Franchisee filter once there are two", () => {
    renderTable(
      [tech()],
      [
        option(),
        option({
          id: "f-2",
          name: "Breeze Services",
          code: "FR1",
          kind: "external",
          isHome: false,
        }),
      ]
    );
    expect(screen.getAllByLabelText("Franchisee").length).toBeGreaterThan(0);
  });
});