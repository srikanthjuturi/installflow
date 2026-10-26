import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Franchisee } from "@/types/franchisee";
import { FranchiseeTable } from "./FranchiseeTable";

function franchisee(overrides: Partial<Franchisee> = {}): Franchisee {
  return {
    id: "f-1",
    code: "FR1",
    name: "Breeze Services",
    kind: "external",
    isHome: false,
    contactName: "P. Rao",
    contactPhone: "+919876543210",
    contactEmail: null,
    isActive: true,
    pincodeRanges: "500030-500040",
    pincodeCount: 11,
    technicianCount: 3,
    openInviteCount: 1,
    adminCount: 2,
    createdAt: "2026-01-10T06:00:00Z",
    ...overrides,
  };
}

const home = franchisee({
  id: "f-home",
  code: "HOME",
  name: "Demo Services",
  kind: "internal",
  isHome: true,
  pincodeRanges: "",
});

function renderTable(
  rows: Franchisee[],
  props: { canManage: boolean } = { canManage: false }
) {
  return render(
    <MemoryRouter>
      <FranchiseeTable
        franchisees={rows}
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
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        canManage={props.canManage}
        onEdit={vi.fn()}
        onPincodes={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("FranchiseeTable", () => {
  afterEach(cleanup);
  it("offers no row actions for a viewer, even where the facts show", () => {
    renderTable([home, franchisee()], { canManage: false });
    expect(screen.getByText("Demo Services")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Edit/ })).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: /Pincodes/ })
    ).toHaveLength(0);
  });

  it("shows the home badge and withholds the Pincodes action on that row", () => {
    renderTable([home, franchisee()], { canManage: true });

    const rows = screen.getAllByRole("row");
    const homeRow = rows.find((r) => r.textContent?.includes("Demo Services"))!;
    expect(within(homeRow).getByText("Home")).toBeInTheDocument();
    expect(
      within(homeRow).getByRole("button", { name: /^Edit/ })
    ).toHaveTextContent("Edit Demo Services");
    // The home's ranges are immutable — there is nothing the dialog could
    // edit, so the action is not offered even to the manager.
    expect(
      within(homeRow).queryAllByRole("button", { name: /^Pincodes/ })
    ).toHaveLength(0);

    const otherRow = rows.find((r) =>
      r.textContent?.includes("Breeze Services")
    )!;
    expect(
      within(otherRow).getByRole("button", { name: /^Pincodes/ })
    ).toHaveTextContent("Pincodes for Breeze Services");
  });
});