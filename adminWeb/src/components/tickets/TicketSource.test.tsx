import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "@/types/ticket";

/**
 * The staff board's Source column: an API ticket names the vendor whose system
 * sent it, the other channels are the plain word, and the vendor's own list —
 * which does not ask for the column — never grows one.
 */

vi.mock("@/services/vendors", async (original) => ({
  ...(await original<typeof import("@/services/vendors")>()),
  listVendorOptions: vi.fn().mockResolvedValue([]),
}));

import { TicketTable } from "./TicketTable";

const ticket = (o: Partial<Ticket>): Ticket =>
  ({
    id: "t1",
    code: "RGT-INST-0001",
    vendorId: "v1",
    vendorName: "ABC Technologies",
    customerName: "Ravi Kumar",
    customerPhone: "+919876543210",
    subcategoryName: "Water purifier",
    modelName: "RO 7",
    serviceType: "Installation + Demo",
    serviceLevelHours: 24,
    slotStart: null,
    slotEnd: null,
    city: "Hyderabad",
    pincode: "500081",
    technicianName: null,
    status: "New",
    slaState: "ok",
    isHighPriority: false,
    source: "Manual",
    createdAt: "2026-11-05T05:30:00Z",
    ...o,
  }) as unknown as Ticket;

function renderTable(showSource: boolean | undefined, tickets: Ticket[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TicketTable
          showSource={showSource}
          tickets={tickets}
          meta={{
            page: 1,
            limit: 20,
            totalRecords: tickets.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          }}
          params={{ page: 1, limit: 20 }}
          onParams={vi.fn()}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TicketTable — Source", () => {
  afterEach(cleanup);

  it("draws API tickets as 'API · <vendor name>' and the others as the plain word", () => {
    renderTable(true, [
      ticket({ id: "t1", code: "RGT-INST-0001", source: "API" }),
      ticket({ id: "t2", code: "RGT-INST-0002", source: "Excel" }),
      ticket({ id: "t3", code: "RGT-INST-0003", source: "Manual" }),
    ]);
    expect(screen.getByRole("columnheader", { name: /Source/ })).toBeInTheDocument();
    // Inside the table only: the Source filter's own pills say the same words.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("API · ABC Technologies")).toBeInTheDocument();
    expect(table.getByText("Excel")).toBeInTheDocument();
    expect(table.getByText("Manual")).toBeInTheDocument();
  });

  it("offers a Source filter with the three channels on the staff board", () => {
    renderTable(true, [ticket({})]);
    expect(screen.getAllByText("Source").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "API" })).toBeInTheDocument();
  });

  it("leaves the vendor's own list untouched", () => {
    renderTable(undefined, [ticket({ source: "API" })]);
    expect(screen.queryByRole("columnheader", { name: /Source/ })).toBeNull();
    expect(screen.queryByText("API · ABC Technologies")).toBeNull();
  });
});
